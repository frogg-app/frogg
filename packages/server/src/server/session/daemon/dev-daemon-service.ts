import { brand } from "@frogg/branding";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, openSync, closeSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import type pino from "pino";
import type {
  DaemonDevBuild,
  DaemonDevDaemonCheckout,
  DaemonDevDaemonStatus,
} from "@frogg/protocol/messages";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";

/**
 * Launches and stops dev builds: `npm run dev:live` in a source checkout of this repo, which runs
 * that checkout's daemon and web app on free ports it picks and reports through its control
 * endpoint. One per checkout, any number at once. Each launcher runs in its own process group so
 * stopping it takes its daemon and web app with it.
 */

const STOP_TIMEOUT_MS = 10_000;
const CONTROL_TIMEOUT_MS = 3000;

interface LauncherControl {
  url: string;
  token: string;
  pid: number;
  /** Absent from launchers older than per-checkout ports. */
  daemonPort?: number;
  webPort?: number;
}

/** What `dev:live`'s control endpoint reports (scripts/dev/preview.mts `controlStatus`). */
interface LauncherStatus {
  daemon: { running: boolean; stale: string[] };
  web: { running: boolean; stale: string[] };
  busy: "daemon" | "web" | null;
  lastError: string | null;
  behindMain: number | null;
  branch: string;
  daemonPort?: number;
  webPort?: number;
}
/** A launcher that dies this soon failed to start; its log says why. */
const STARTUP_CHECK_MS = 4000;

/** Written beside the checkout's control file by `start`, before the launcher writes its own. */
interface LaunchRecord {
  pid: number;
  startedAt: string;
}

export type SpawnDevLauncher = (
  cwd: string,
  env: NodeJS.ProcessEnv,
  logPath: string,
) => Pick<ChildProcess, "pid" | "unref">;

export interface DevDaemonServiceOptions {
  logger: pino.Logger;
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

/** What a dev build's launcher reports; a launcher still starting has reported nothing yet. */
function launcherFields(
  launcher: LauncherStatus | null,
  control: LauncherControl | null,
  branch: string | null,
) {
  if (!launcher) {
    return {
      branch,
      daemonPort: control?.daemonPort ?? null,
      webPort: control?.webPort ?? null,
      ready: false,
      webReady: false,
      daemonStale: [],
      webStale: [],
      busy: null,
      lastError: null,
      behindMain: null,
    };
  }
  return {
    branch: launcher.branch,
    daemonPort: launcher.daemonPort ?? control?.daemonPort ?? null,
    webPort: launcher.webPort ?? control?.webPort ?? null,
    ready: launcher.daemon.running,
    webReady: launcher.web.running,
    daemonStale: launcher.daemon.stale,
    webStale: launcher.web.stale,
    busy: launcher.busy,
    lastError: launcher.lastError,
    behindMain: launcher.behindMain,
  };
}

/** COMPAT(devBuilds): the single dev build clients older than `instances` read. */
function legacyFields(build: DaemonDevBuild) {
  return {
    running: true,
    ready: build.ready,
    cwd: build.cwd,
    branch: build.branch,
    startedAt: build.startedAt,
    daemonPort: build.daemonPort ?? 0,
    webPort: build.webPort ?? 0,
    logPath: build.logPath,
    canRebuild: build.canRebuild,
    webReady: build.webReady,
    daemonStale: build.daemonStale,
    webStale: build.webStale,
    busy: build.busy,
    lastError: build.lastError,
    behindMain: build.behindMain,
  };
}

const NO_LEGACY_BUILD = {
  running: false,
  ready: false,
  cwd: null,
  branch: null,
  startedAt: null,
  daemonPort: 0,
  webPort: 0,
  logPath: null,
  canRebuild: false,
};

function liveDir(cwd: string): string {
  return path.join(cwd, ".dev", "live");
}

export class DevDaemonService {
  private readonly logger: pino.Logger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly spawnLauncher: SpawnDevLauncher;
  private readonly isAlive: (pid: number) => boolean;
  private readonly killGroup: (pid: number, signal: NodeJS.Signals) => void;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly now: () => Date;
  private readonly startupCheckMs: number;
  private readonly siblingWorkspaceFiles: string[];
  /** Checkouts seen by the last status call, so a bare `stop` can find every running build. */
  private knownCheckouts = new Set<string>();

  constructor(options: DevDaemonServiceOptions) {
    this.siblingWorkspaceFiles = options.siblingWorkspaceFiles ?? [];
    this.logger = options.logger.child({ module: "dev-daemon" });
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
    this.fetchImpl = options.fetchImpl;
    this.now = options.now ?? (() => new Date());
    this.startupCheckMs = options.startupCheckMs ?? STARTUP_CHECK_MS;
  }

  unsupportedReason(): string | null {
    if (this.platform === "win32") return "Launching a dev build needs Linux or macOS.";
    return null;
  }

  /** This daemon is a dev build: `dev:live` hands it its launcher's control file. */
  private get isSelf(): boolean {
    return Boolean(this.env.FROGG_DEV_CONTROL_FILE);
  }

  private get selfRoot(): string | null {
    const file = this.env.FROGG_DEV_CONTROL_FILE;
    return this.env.FROGG_DEV_ROOT ?? (file ? path.resolve(path.dirname(file), "..", "..") : null);
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
    if (this.isSelf && cwd === this.selfRoot) {
      const file = this.env.FROGG_DEV_CONTROL_FILE;
      return file ? this.readControl(file) : null;
    }
    return this.readControl(path.join(liveDir(cwd), "control.json"));
  }

  private launchRecord(cwd: string): LaunchRecord | null {
    try {
      const record = JSON.parse(
        readFileSync(path.join(liveDir(cwd), "launcher.json"), "utf8"),
      ) as LaunchRecord;
      return typeof record.pid === "number" && this.isAlive(record.pid) ? record : null;
    } catch {
      return null;
    }
  }

  /** The launcher running in `cwd`, whether this daemon started it or someone ran it by hand. */
  private launcherPid(cwd: string): number | null {
    return this.controlFor(cwd)?.pid ?? this.launchRecord(cwd)?.pid ?? null;
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

  /**
   * Asks a launcher to rebuild: the one in `cwd`, else this daemon's own, else the only one
   * running. Returns an error message, or null once it has accepted.
   */
  async rebuild(target: "daemon" | "web", cwd?: string): Promise<string | null> {
    const resolved =
      cwd ??
      this.selfRoot ??
      [...this.knownCheckouts].find((candidate) => this.controlFor(candidate)) ??
      null;
    const control = resolved ? this.controlFor(resolved) : null;
    if (!control) return "That dev build's launcher is not running.";
    try {
      const response = await (this.fetchImpl ?? fetch)(`${control.url}/rebuild?target=${target}`, {
        method: "POST",
        headers: { authorization: `Bearer ${control.token}` },
        signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
      });
      if (response.ok) return null;
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      return body.error ?? `The launcher answered ${response.status}.`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
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
    const selfRoot = this.isSelf ? this.selfRoot : null;
    if (selfRoot && !checkouts.has(selfRoot)) {
      checkouts.set(selfRoot, {
        cwd: selfRoot,
        name: path.basename(selfRoot),
        branch: null,
      });
    }
    this.knownCheckouts = new Set(checkouts.keys());
    const instances = (
      await Promise.all([...checkouts.values()].map((checkout) => this.instance(checkout)))
    ).filter((instance): instance is DaemonDevBuild => instance !== null);
    // Older clients read one dev build from the top-level fields: this daemon's own, else the first.
    const primary = instances.find((instance) => instance.cwd === selfRoot) ?? instances[0];
    return {
      supported: reason === null,
      reason,
      checkouts: [...checkouts.values()],
      isSelf: this.isSelf,
      ...(primary ? legacyFields(primary) : NO_LEGACY_BUILD),
      selfCwd: selfRoot,
      instances,
    };
  }

  private async instance(checkout: DaemonDevDaemonCheckout): Promise<DaemonDevBuild | null> {
    const control = this.controlFor(checkout.cwd);
    const record = this.launchRecord(checkout.cwd);
    if (!control && !record) return null;
    const launcher = control ? await this.fetchLauncherStatus(control) : null;
    return {
      cwd: checkout.cwd,
      name: checkout.name,
      startedAt: record?.startedAt ?? null,
      logPath: path.join(liveDir(checkout.cwd), "launcher.log"),
      canRebuild: control !== null,
      ...launcherFields(launcher, control, checkout.branch),
    };
  }

  /** Returns an error message, or null once the launcher is running (or already was). */
  async start(cwd: string): Promise<string | null> {
    const reason = this.unsupportedReason();
    if (reason) return reason;
    if (!isDevCheckout(cwd)) return `${cwd} is not a ${brand.name} source checkout.`;
    if (!existsSync(path.join(cwd, "node_modules"))) {
      return `${cwd} has no node_modules; run npm ci there first.`;
    }
    if (this.launcherPid(cwd) !== null) return null;

    const logDir = liveDir(cwd);
    await mkdir(logDir, { recursive: true });
    const logPath = path.join(logDir, "launcher.log");
    const recordPath = path.join(logDir, "launcher.json");
    // Nothing aimed at this daemon (its home, listen address, production mode) may reach the
    // launcher, which sets its own and picks its own ports.
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (key.startsWith("FROGG_") || key.startsWith(`${brand.envPrefix}_`)) continue;
      if (key === "NODE_ENV" || key === "PREVIEW_PORT" || key === "LIVE_DAEMON_PORT") continue;
      env[key] = value;
    }
    try {
      const child = this.spawnLauncher(cwd, env, logPath);
      if (!child.pid) return "The dev build did not start.";
      child.unref();
      const record: LaunchRecord = {
        pid: child.pid,
        startedAt: this.now().toISOString(),
      };
      await writeFile(recordPath, JSON.stringify(record));
      const deadline = Date.now() + this.startupCheckMs;
      while (Date.now() < deadline && this.isAlive(child.pid)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!this.isAlive(child.pid)) {
        await rm(recordPath, { force: true });
        return `The dev build exited while starting${lastLogLine(logPath)}`;
      }
      this.logger.info({ cwd, pid: child.pid }, "dev build launched");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Stops the dev build in `cwd`, or every one this daemon knows of when `cwd` is omitted (what
   * older clients send). A dev build cannot stop itself. Returns an error message or null.
   */
  async stop(cwd?: string): Promise<string | null> {
    const selfRoot = this.isSelf ? this.selfRoot : null;
    if (cwd !== undefined && cwd === selfRoot) {
      return "This is that dev build; stop it from the stable or beta daemon.";
    }
    const targets = cwd !== undefined ? [cwd] : [...this.knownCheckouts];
    for (const target of targets) {
      if (target === selfRoot) continue;
      const error = await this.stopOne(target);
      if (error) return error;
    }
    return null;
  }

  private async stopOne(cwd: string): Promise<string | null> {
    const pid = this.launcherPid(cwd);
    if (pid !== null) {
      try {
        this.killGroup(pid, "SIGTERM");
        const deadline = Date.now() + STOP_TIMEOUT_MS;
        while (this.isAlive(pid) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        if (this.isAlive(pid)) this.killGroup(pid, "SIGKILL");
      } catch (error) {
        if (this.isAlive(pid)) {
          return error instanceof Error ? error.message : String(error);
        }
      }
      this.logger.info({ cwd, pid }, "dev build stopped");
    }
    await rm(path.join(liveDir(cwd), "launcher.json"), { force: true });
    return null;
  }
}
