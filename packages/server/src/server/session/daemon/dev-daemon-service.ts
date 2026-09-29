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

export const DEV_DAEMON_PORT = 9898;
export const DEV_WEB_PORT = 7820;
const STOP_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 1500;
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
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnLauncher?: SpawnDevLauncher;
  isAlive?: (pid: number) => boolean;
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
  probe?: (port: number) => Promise<boolean>;
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
  private readonly now: () => Date;
  private readonly startupCheckMs: number;

  constructor(options: DevDaemonServiceOptions) {
    this.logger = options.logger.child({ module: "dev-daemon" });
    this.statePath = path.join(options.froggHome, "dev-daemon.json");
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.spawnLauncher = options.spawnLauncher ?? defaultSpawnLauncher;
    this.isAlive = options.isAlive ?? processIsAlive;
    this.killGroup = options.killGroup ?? ((pid, signal) => process.kill(-pid, signal));
    this.probe = options.probe ?? probeStatus;
    this.now = options.now ?? (() => new Date());
    this.startupCheckMs = options.startupCheckMs ?? STARTUP_CHECK_MS;
  }

  unsupportedReason(): string | null {
    if (this.platform === "win32") return "Launching a development daemon needs Linux or macOS.";
    if (this.env.FROGG_LISTEN?.endsWith(`:${DEV_DAEMON_PORT}`)) {
      return "This is the development daemon; launch one from the stable or beta daemon.";
    }
    return null;
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

  async status(workspaces: PersistedWorkspaceRecord[]): Promise<DaemonDevDaemonStatus> {
    const reason = this.unsupportedReason();
    const state = this.liveState();
    const checkouts = new Map<string, DaemonDevDaemonCheckout>();
    for (const workspace of workspaces) {
      if (workspace.archivedAt || checkouts.has(workspace.cwd)) continue;
      if (!isDevCheckout(workspace.cwd)) continue;
      checkouts.set(workspace.cwd, {
        cwd: workspace.cwd,
        name: workspace.title || workspace.displayName,
        branch: workspace.branch ?? null,
      });
    }
    return {
      supported: reason === null,
      reason,
      running: state !== null,
      ready: state !== null && (await this.probe(DEV_DAEMON_PORT)),
      cwd: state?.cwd ?? null,
      branch: state ? (checkouts.get(state.cwd)?.branch ?? null) : null,
      startedAt: state?.startedAt ?? null,
      daemonPort: DEV_DAEMON_PORT,
      webPort: DEV_WEB_PORT,
      logPath: state?.logPath ?? null,
      checkouts: [...checkouts.values()],
    };
  }

  /** Returns an error message, or null once the launcher is running. */
  async start(cwd: string): Promise<string | null> {
    const reason = this.unsupportedReason();
    if (reason) return reason;
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
    const state = this.liveState();
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
