import { brand } from "@frogg/branding";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, openSync, closeSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import type pino from "pino";
import type { DaemonDevDaemonCheckout, DaemonDevDaemonStatus } from "@frogg/protocol/messages";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";

/**
 * Launches and stops the development daemon: `npm run dev:live` in a source checkout of this
 * repo, which runs that checkout's daemon on DEV_DAEMON_PORT and its web app on DEV_WEB_PORT.
 * One at a time; launching another checkout stops the running one first. The launcher runs in
 * its own process group so stopping it takes the daemon and web app with it.
 */

export const DEV_DAEMON_PORT = 9899;
export const DEV_WEB_PORT = 9898;
const STOP_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 1500;
const CONTROL_TIMEOUT_MS = 3000;

interface LauncherControl {
  url: string;
  token: string;
  pid: number;
}

/** What `dev:live`'s control endpoint reports (scripts/dev/preview.mts `controlStatus`). */
interface LauncherStatus {
  daemon: { running: boolean; stale: string[] };
  web: { running: boolean; stale: string[] };
  busy: "daemon" | "web" | null;
  lastError: string | null;
  behindMain: number | null;
  branch: string;
}
/** A launcher that dies this soon failed to start; its log says why. */
const STARTUP_CHECK_MS = 4000;

interface DevDaemonState {
  pid: number;
  cwd: string;
  startedAt: string;
  logPath: string;
}

export type SpawnDevLauncher = (
  cwd: string,
  env: NodeJS.ProcessEnv,
  logPath: string,
) => Pick<ChildProcess, "pid" | "unref">;

export interface DevDaemonServiceOptions {
  logger: pino.Logger;
  froggHome: string;
  /**
   * The workspace registries of this host's other channels (stable, beta). Their checkouts are
   * offered too: a beta daemon has its own projects, but the frogg checkout usually lives in the
   * stable daemon's.
   */
  siblingWorkspaceFiles?: string[];
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnLauncher?: SpawnDevLauncher;
  isAlive?: (pid: number) => boolean;
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  probe?: (port: number) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  startupCheckMs?: number;
}

const defaultSpawnLauncher: SpawnDevLauncher = (cwd, env, logPath) => {
  const fd = openSync(logPath, "a");
  try {
    return spawn("npm", ["run", "dev:live"], {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
};

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function probeStatus(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: "/api/status", timeout: PROBE_TIMEOUT_MS },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

/** `: <last error line>` from the launcher log, or "" when there is none. */
function lastLogLine(logPath: string): string {
  try {
    const lines = stripVTControlCharacters(readFileSync(logPath, "utf8"))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-40);
    const line =
      lines.findLast((candidate) => /^(\w*Error|error)\b/.test(candidate)) ?? lines.at(-1);
    return line ? `: ${line}` : "";
  } catch {
    return "";
  }
}

/** A checkout `dev:live` can run in: this repo's launcher script and its package script. */
export function isDevCheckout(cwd: string): boolean {
  if (!existsSync(path.join(cwd, "scripts", "dev", "preview.mts"))) return false;
  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      scripts?: Record<string, unknown>;
    };
    return typeof pkg.scripts?.["dev:live"] === "string";
  } catch {
    return false;
  }
}

export class DevDaemonService {
  private readonly logger: pino.Logger;
  private readonly statePath: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly spawnLauncher: SpawnDevLauncher;
  private readonly isAlive: (pid: number) => boolean;
  private readonly killGroup: (pid: number, signal: NodeJS.Signals) => void;
  private readonly probe: (port: number) => Promise<boolean>;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly now: () => Date;
  /** Checkouts seen by the last status call, where a hand-started launcher may be running. */
  private knownCheckouts: string[] = [];
  private readonly startupCheckMs: number;
  private readonly siblingWorkspaceFiles: string[];

  constructor(options: DevDaemonServiceOptions) {
    this.siblingWorkspaceFiles = options.siblingWorkspaceFiles ?? [];
    this.logger = options.logger.child({ module: "dev-daemon" });
    this.statePath = path.join(options.froggHome, "dev-daemon.json");
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.spawnLauncher = options.spawnLauncher ?? defaultSpawnLauncher;
    this.isAlive = options.isAlive ?? processIsAlive;
    this.killGroup =
      options.killGroup ??
      ((pid, signal) => {
        try {
          process.kill(-pid, signal);
        } catch {
          // A launcher started by hand is not a group leader; it stops its own children.
          process.kill(pid, signal);
        }
      });
    this.probe = options.probe ?? probeStatus;
    this.fetchImpl = options.fetchImpl;
    this.now = options.now ?? (() => new Date());
    this.startupCheckMs = options.startupCheckMs ?? STARTUP_CHECK_MS;
  }

  unsupportedReason(): string | null {
    if (this.platform === "win32") return "Launching a development daemon needs Linux or macOS.";
    return null;
  }

  /** This daemon is the development daemon: `dev:live` hands it its launcher's control file. */
  private get isSelf(): boolean {
    return (
      Boolean(this.env.FROGG_DEV_CONTROL_FILE) ||
      Boolean(this.env.FROGG_LISTEN?.endsWith(`:${DEV_DAEMON_PORT}`))
    );
  }

  /** The launcher's control endpoint (scripts/dev/preview.mts), while that launcher runs. */
  private readControl(file: string): LauncherControl | null {
    try {
      const control = JSON.parse(readFileSync(file, "utf8")) as Partial<LauncherControl>;
      if (typeof control.url !== "string" || typeof control.token !== "string") return null;
      if (typeof control.pid !== "number" || !this.isAlive(control.pid)) return null;
      return control as LauncherControl;
    } catch {
      return null;
    }
  }

  private controlFor(cwd: string): LauncherControl | null {
    return this.readControl(path.join(cwd, ".dev", "live", "control.json"));
  }

  private selfControl(): LauncherControl | null {
    const file = this.env.FROGG_DEV_CONTROL_FILE;
    return file ? this.readControl(file) : null;
  }

  private async fetchLauncherStatus(control: LauncherControl): Promise<LauncherStatus | null> {
    try {
      const response = await (this.fetchImpl ?? fetch)(`${control.url}/status`, {
        headers: { authorization: `Bearer ${control.token}` },
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
      });
      return response.ok ? ((await response.json()) as LauncherStatus) : null;
    } catch {
      return null;
    }
  }

  /** Asks the launcher to rebuild. Returns an error message, or null once it has accepted. */
  async rebuild(target: "daemon" | "web"): Promise<string | null> {
    const state = this.isSelf ? null : this.liveState();
    const control = this.isSelf ? this.selfControl() : state && this.controlFor(state.cwd);
    if (!control) return "The development daemon's launcher is not running.";
    try {
      const response = await (this.fetchImpl ?? fetch)(`${control.url}/rebuild?target=${target}`, {
        method: "POST",
        headers: { authorization: `Bearer ${control.token}` },
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
      });
      if (response.ok) return null;
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return body.error ?? `The launcher answered ${response.status}.`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private readState(): DevDaemonState | null {
    try {
      const state = JSON.parse(readFileSync(this.statePath, "utf8")) as DevDaemonState;
      return typeof state.pid === "number" ? state : null;
    } catch {
      return null;
    }
  }

  private liveState(): DevDaemonState | null {
    const state = this.readState();
    return state && this.isAlive(state.pid) ? state : null;
  }

  /** A `dev:live` started by hand in one of the checkouts, which this daemon did not launch. */
  private adoptedState(checkouts: Iterable<string>): DevDaemonState | null {
    for (const cwd of checkouts) {
      const control = this.controlFor(cwd);
      if (!control) continue;
      return {
        pid: control.pid,
        cwd,
        startedAt: "",
        logPath: path.join(cwd, ".dev", "live", "launcher.log"),
      };
    }
    return null;
  }

  /** The other channels' workspaces, read straight from their registry files; unreadable ones are skipped. */
  private readSiblingWorkspaces(): Pick<
    PersistedWorkspaceRecord,
    "cwd" | "title" | "displayName" | "branch" | "archivedAt"
  >[] {
    const records: Pick<
      PersistedWorkspaceRecord,
      "cwd" | "title" | "displayName" | "branch" | "archivedAt"
    >[] = [];
    for (const file of this.siblingWorkspaceFiles) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const entry of parsed as Record<string, unknown>[]) {
        if (!entry || typeof entry.cwd !== "string") continue;
        records.push({
          cwd: entry.cwd,
          title: typeof entry.title === "string" ? entry.title : null,
          displayName: typeof entry.displayName === "string" ? entry.displayName : entry.cwd,
          branch: typeof entry.branch === "string" ? entry.branch : null,
          archivedAt: typeof entry.archivedAt === "string" ? entry.archivedAt : null,
        });
      }
    }
    return records;
  }

  async status(workspaces: PersistedWorkspaceRecord[]): Promise<DaemonDevDaemonStatus> {
    const reason = this.unsupportedReason();
    const checkouts = new Map<string, DaemonDevDaemonCheckout>();
    for (const workspace of [...workspaces, ...this.readSiblingWorkspaces()]) {
      if (workspace.archivedAt || checkouts.has(workspace.cwd)) continue;
      if (!isDevCheckout(workspace.cwd)) continue;
      checkouts.set(workspace.cwd, {
        cwd: workspace.cwd,
        name: workspace.title || workspace.displayName,
        branch: workspace.branch ?? null,
      });
    }
    this.knownCheckouts = [...checkouts.keys()];
    const isSelf = this.isSelf;
    const state = isSelf ? null : (this.liveState() ?? this.adoptedState(checkouts.keys()));
    const control = isSelf ? this.selfControl() : state && this.controlFor(state.cwd);
    const launcher = control ? await this.fetchLauncherStatus(control) : null;
    const running = isSelf || state !== null;
    const selfRoot = isSelf ? (this.env.FROGG_DEV_ROOT ?? null) : null;
    return {
      supported: reason === null,
      reason,
      running,
      cwd: state?.cwd ?? selfRoot,
      branch: launcher?.branch ?? (state ? (checkouts.get(state.cwd)?.branch ?? null) : null),
      startedAt: state?.startedAt || null,
      daemonPort: DEV_DAEMON_PORT,
      webPort: DEV_WEB_PORT,
      logPath: state?.logPath ?? null,
      checkouts: [...checkouts.values()],
      isSelf,
      canRebuild: control !== null,
      ...(await this.launcherFields(launcher, running)),
    };
  }

  private async launcherFields(launcher: LauncherStatus | null, running: boolean) {
    if (!launcher) {
      return {
        ready: running && (await this.probe(DEV_DAEMON_PORT)),
        webReady: running && (await this.probe(DEV_WEB_PORT)),
        daemonStale: [],
        webStale: [],
        busy: null,
        lastError: null,
        behindMain: null,
      };
    }
    return {
      ready: launcher.daemon.running,
      webReady: launcher.web.running,
      daemonStale: launcher.daemon.stale,
      webStale: launcher.web.stale,
      busy: launcher.busy,
      lastError: launcher.lastError,
      behindMain: launcher.behindMain,
    };
  }

  /** Returns an error message, or null once the launcher is running. */
  async start(cwd: string): Promise<string | null> {
    const reason = this.unsupportedReason();
    if (reason) return reason;
    if (this.isSelf)
      return "This is the development daemon; start another one from the stable or beta daemon.";
    if (!isDevCheckout(cwd)) return `${cwd} is not a ${brand.name} source checkout.`;
    if (!existsSync(path.join(cwd, "node_modules"))) {
      return `${cwd} has no node_modules; run npm ci there first.`;
    }
    const stopError = await this.stop();
    if (stopError) return stopError;

    const logDir = path.join(cwd, ".dev", "live");
    await mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, "launcher.log");
    // Nothing aimed at this daemon (its home, listen address, production mode) may reach the
    // launcher, which sets its own.
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (key.startsWith("FROGG_") || key.startsWith(`${brand.envPrefix}_`)) continue;
      if (key === "NODE_ENV") continue;
      env[key] = value;
    }
    env.LIVE_DAEMON_PORT = String(DEV_DAEMON_PORT);
    env.PREVIEW_PORT = String(DEV_WEB_PORT);
    try {
      const child = this.spawnLauncher(cwd, env, logPath);
      if (!child.pid) return "The development daemon did not start.";
      child.unref();
      const state: DevDaemonState = {
        pid: child.pid,
        cwd,
        startedAt: this.now().toISOString(),
        logPath,
      };
      await writeFile(this.statePath, JSON.stringify(state));
      const deadline = Date.now() + this.startupCheckMs;
      while (Date.now() < deadline && this.isAlive(child.pid)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!this.isAlive(child.pid)) {
        await rm(this.statePath, { force: true });
        return `The development daemon exited while starting${lastLogLine(logPath)}`;
      }
      this.logger.info({ cwd, pid: child.pid }, "development daemon launched");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /** Stops the running launcher and everything it started. Returns an error message or null. */
  async stop(): Promise<string | null> {
    if (this.isSelf)
      return "This is the development daemon; stop it from the stable or beta daemon.";
    const state = this.liveState() ?? this.adoptedState(this.knownCheckouts);
    if (state) {
      try {
        this.killGroup(state.pid, "SIGTERM");
        const deadline = Date.now() + STOP_TIMEOUT_MS;
        while (this.isAlive(state.pid) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (this.isAlive(state.pid)) this.killGroup(state.pid, "SIGKILL");
      } catch (error) {
        if (this.isAlive(state.pid)) {
          return error instanceof Error ? error.message : String(error);
        }
      }
      this.logger.info({ cwd: state.cwd, pid: state.pid }, "development daemon stopped");
    }
    await rm(this.statePath, { force: true });
    return null;
  }
}
