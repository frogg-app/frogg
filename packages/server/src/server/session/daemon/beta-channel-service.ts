import { brand } from "@frogg/branding";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type pino from "pino";
import type {
  DaemonBetaChannelRun,
  DaemonBetaChannelRunCompletedMessage,
  DaemonBetaChannelStatus,
} from "@frogg/protocol/messages";
import type { SessionOutboundMessage } from "../../messages.js";
import {
  downloadReleaseAsset,
  fetchBetaRelease,
  type BetaRelease,
  type BetaReleaseAsset,
} from "./beta-release.js";

/**
 * Installs, updates and removes the side-by-side beta daemon from the stable
 * daemon. It does not reimplement the installer: it runs the beta release's own
 * install.sh / uninstall.sh after checking GitHub's sha256 digest and the
 * script's brand header, with this daemon's environment scrubbed so nothing
 * aimed at the stable install (home, install dir, listen address) leaks in.
 * One run at a time; progress is broadcast to every owner session.
 */

export type BetaChannelAction = "install" | "uninstall";

export type SpawnInstallerScript = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; cwd: string },
) => ChildProcess;

export interface BetaDaemonProbe {
  version: string | null;
}

export interface BetaChannelServiceOptions {
  logger: pino.Logger;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
  tmpdir?: string;
  /** The running build's channel; the beta build refuses to manage itself. */
  selfChannel?: "stable" | "beta";
  isDocker?: () => boolean;
  /** A path inside the running daemon, used to detect a Nix store install. */
  modulePath?: string;
  fetchImpl?: typeof fetch;
  spawnScript?: SpawnInstallerScript;
  probeDaemon?: (port: number) => Promise<BetaDaemonProbe | null>;
  probeWeb?: (port: number) => Promise<boolean>;
  now?: () => Date;
  runTimeoutMs?: number;
  latestCacheMs?: number;
}

export type BetaChannelStatusPayload = DaemonBetaChannelStatus;

export interface BetaChannelStartResult {
  accepted: boolean;
  runId: string | null;
  targetVersion: string | null;
  error: string | null;
}

interface ScriptHeader {
  [key: string]: string;
}

const DEFAULT_RUN_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_LATEST_CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 1500;
const CONTROL_TIMEOUT_MS = 60_000;

/** The `BRAND_X='value'` defaults block every generated installer starts with. */
export function parseScriptHeader(script: string): ScriptHeader {
  const header: ScriptHeader = {};
  for (const line of script.split("\n", 200)) {
    const match = /^BRAND_([A-Z_]+)='([^']*)'$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) header[match[1]] = match[2];
  }
  return header;
}

export function sha256Hex(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Every variable an installer would read as an override, for any channel of this brand. */
function scrubInstallerEnv(env: NodeJS.ProcessEnv, prefixes: string[]): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (prefixes.some((prefix) => key.startsWith(`${prefix}_`))) continue;
    out[key] = value;
  }
  return out;
}

const defaultSpawnScript: SpawnInstallerScript = (command, args, options) =>
  spawn(command, args, {
    env: options.env,
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

/** Asks `127.0.0.1:<port>/api/identity` whether the beta daemon answers there. */
export function probeBetaDaemon(betaId: string) {
  return (port: number): Promise<BetaDaemonProbe | null> =>
    new Promise((resolve) => {
      const request = http.get(
        { host: "127.0.0.1", port, path: "/api/identity", timeout: PROBE_TIMEOUT_MS },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => {
            try {
              const parsed = JSON.parse(body) as { version?: unknown; brand?: { id?: unknown } };
              if (parsed.brand && parsed.brand.id !== betaId) {
                resolve(null);
                return;
              }
              resolve({ version: typeof parsed.version === "string" ? parsed.version : null });
            } catch {
              resolve(null);
            }
          });
        },
      );
      request.on("timeout", () => request.destroy());
      request.on("error", () => resolve(null));
    });
}

/** Whether anything accepts connections on `port` at loopback or any of this host's addresses. */
export async function probeListening(port: number): Promise<boolean> {
  const addresses = ["127.0.0.1"];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  const results = await Promise.all(
    addresses.map(
      (host) =>
        new Promise<boolean>((resolve) => {
          const socket = net.connect({ host, port, timeout: PROBE_TIMEOUT_MS });
          socket.once("connect", () => {
            socket.destroy();
            resolve(true);
          });
          socket.once("timeout", () => {
            socket.destroy();
            resolve(false);
          });
          socket.once("error", () => resolve(false));
        }),
    ),
  );
  return results.includes(true);
}

export class BetaChannelService {
  private readonly logger: pino.Logger;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly homedir: string;
  private readonly tmpdir: string;
  private readonly selfChannel: "stable" | "beta";
  private readonly isDocker: () => boolean;
  private readonly modulePath: string | null;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly spawnScript: SpawnInstallerScript;
  private readonly probeDaemon: (port: number) => Promise<BetaDaemonProbe | null>;
  private readonly probeWeb: (port: number) => Promise<boolean>;
  private readonly now: () => Date;
  private readonly runTimeoutMs: number;
  private readonly latestCacheMs: number;
  private broadcaster: ((msg: SessionOutboundMessage) => void) | null = null;
  private run: DaemonBetaChannelRun | null = null;
  private completion: Promise<void> | null = null;
  private latestCache: { at: number; release: BetaRelease | null; error: string | null } | null =
    null;

  constructor(options: BetaChannelServiceOptions) {
    this.logger = options.logger.child({ module: "beta-channel" });
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.homedir = options.homedir ?? os.homedir();
    this.tmpdir = options.tmpdir ?? os.tmpdir();
    this.selfChannel = options.selfChannel ?? brand.channel;
    this.isDocker =
      options.isDocker ?? (() => this.env.FROGG_DOCKER === "1" || existsSync("/.dockerenv"));
    this.modulePath = options.modulePath ?? null;
    this.fetchImpl = options.fetchImpl;
    this.spawnScript = options.spawnScript ?? defaultSpawnScript;
    this.probeDaemon = options.probeDaemon ?? probeBetaDaemon(brand.channels.beta.id);
    this.probeWeb = options.probeWeb ?? probeListening;
    this.now = options.now ?? (() => new Date());
    this.runTimeoutMs = options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    this.latestCacheMs = options.latestCacheMs ?? DEFAULT_LATEST_CACHE_MS;
  }

  setBroadcaster(broadcaster: (msg: SessionOutboundMessage) => void): void {
    this.broadcaster = broadcaster;
  }

  /** Resolves when the in-flight run (if any) has finished. For tests and shutdown. */
  async idle(): Promise<void> {
    await this.completion;
  }

  private get beta() {
    return brand.channels.beta;
  }

  /** `~/.local/share/<beta id>`, install.sh's default for the beta build. */
  get installDir(): string {
    return path.join(this.homedir, ".local", "share", this.beta.id);
  }

  /** Why install/uninstall cannot run here, or null when they can. */
  unsupportedReason(): string | null {
    if (this.selfChannel === "beta") {
      return `This daemon is ${this.beta.name} itself. Manage the beta from the stable ${brand.channels.stable.name} daemon, and update this one with its own daemon update.`;
    }
    if (this.platform === "win32") {
      return "Windows hosts have no beta installer script; install the beta daemon bundle from the beta release page.";
    }
    if (this.platform !== "linux" && this.platform !== "darwin") {
      return `Beta daemon install is not supported on ${this.platform}.`;
    }
    if (this.isDocker()) {
      return "This daemon runs in Docker; run the beta as a separate container instead.";
    }
    if (this.modulePath?.startsWith("/nix/store/")) {
      return "This daemon is a Nix install; add the beta through your Nix configuration instead.";
    }
    if (brand.distribution.updateMode === "disabled" || !brand.distribution.releasesApi) {
      return `${brand.name} has no release source to install a beta from.`;
    }
    return null;
  }

  private readInstalledVersion(): string | null {
    const current = path.join(this.installDir, "current");
    try {
      const manifest = JSON.parse(readFileSync(path.join(current, "manifest.json"), "utf8")) as {
        version?: unknown;
      };
      if (typeof manifest.version === "string") return manifest.version;
    } catch {
      // Fall through to the versions/<v> link target.
    }
    try {
      return path.basename(realpathSync(current));
    } catch {
      return null;
    }
  }

  private async latest(): Promise<{ release: BetaRelease | null; error: string | null }> {
    const cached = this.latestCache;
    if (cached && this.now().getTime() - cached.at < this.latestCacheMs) return cached;
    let release: BetaRelease | null = null;
    let error: string | null = null;
    try {
      release = await fetchBetaRelease({ env: this.env, fetchImpl: this.fetchImpl });
      if (!release) error = "no published beta release found";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    this.latestCache = { at: this.now().getTime(), release, error };
    return this.latestCache;
  }

  async status(): Promise<BetaChannelStatusPayload> {
    const reason = this.unsupportedReason();
    const selfIsBeta = this.selfChannel === "beta";
    const installedVersion = selfIsBeta ? null : this.readInstalledVersion();
    const [probe, latest, webRunning] = await Promise.all([
      this.probeDaemon(this.beta.daemonPort),
      this.latest(),
      this.probeWeb(this.beta.webPort),
    ]);
    return {
      supported: reason === null,
      reason,
      selfIsBeta,
      platform: this.platform,
      installed: selfIsBeta || installedVersion !== null,
      installedVersion,
      installDir: this.platform === "win32" ? null : this.installDir,
      running: probe !== null,
      runningVersion: probe?.version ?? null,
      port: this.beta.daemonPort,
      webPort: this.beta.webPort,
      webRunning,
      serviceName: this.beta.serviceName,
      cliName: this.beta.cliName,
      homeDir: path.join(this.homedir, this.beta.homeDir),
      latestVersion: latest.release?.version ?? null,
      latestReleaseUrl: latest.release?.htmlUrl ?? null,
      latestPublishedAt: latest.release?.publishedAt ?? null,
      latestError: latest.error,
      run: this.run,
    };
  }

  install(input: { version?: string } = {}): BetaChannelStartResult {
    return this.start("install", { version: input.version });
  }

  uninstall(input: { purge?: boolean } = {}): BetaChannelStartResult {
    return this.start("uninstall", { purge: input.purge === true });
  }

  /**
   * Starts or stops the installed beta daemon with its own CLI, which knows whether a service
   * supervises it. Returns an error message, or null on success.
   */
  async setRunning(running: boolean): Promise<string | null> {
    const reason = this.unsupportedReason();
    if (reason) return reason;
    if (this.readInstalledVersion() === null)
      return `${this.beta.name} is not installed on this host`;
    const cli = path.join(this.installDir, "current", "bin", this.beta.cliName);
    const betaPrefix = `${brand.channels.stable.id.toUpperCase()}_BETA`;
    const env = scrubInstallerEnv(this.env, ["FROGG", brand.envPrefix, betaPrefix]);
    const verb = running ? "start" : "stop";
    try {
      await new Promise<void>((resolve, reject) => {
        const child = this.spawnScript(cli, ["daemon", verb], { env, cwd: this.homedir });
        let tail = "";
        const collect = (chunk: Buffer) => {
          tail = (tail + chunk.toString("utf8")).slice(-2000);
        };
        child.stdout?.on("data", collect);
        child.stderr?.on("data", collect);
        const timer = setTimeout(() => child.kill(), CONTROL_TIMEOUT_MS);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("close", (code, signal) => {
          clearTimeout(timer);
          if (code === 0) {
            resolve();
            return;
          }
          const last = tail.trim().split("\n").at(-1);
          reject(
            new Error(
              `${this.beta.cliName} daemon ${verb} exited with ${code ?? signal}${last ? `: ${last}` : ""}`,
            ),
          );
        });
      });
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private start(
    action: BetaChannelAction,
    input: { version?: string; purge?: boolean },
  ): BetaChannelStartResult {
    const reason = this.unsupportedReason();
    if (reason) return { accepted: false, runId: null, targetVersion: null, error: reason };
    if (this.run) {
      return {
        accepted: false,
        runId: this.run.runId,
        targetVersion: this.run.targetVersion,
        error: `a beta ${this.run.action} is already in progress`,
      };
    }
    if (action === "uninstall" && this.readInstalledVersion() === null) {
      return {
        accepted: false,
        runId: null,
        targetVersion: null,
        error: `${this.beta.name} is not installed on this host`,
      };
    }
    const runId = randomUUID();
    const at = this.now().toISOString();
    this.run = {
      runId,
      action,
      targetVersion: input.version ?? null,
      phase: "resolve",
      message: "resolving the beta release",
      startedAt: at,
      at,
    };
    this.broadcastProgress();
    this.completion = this.execute(action, input)
      .then((version) => this.finish("succeeded", version, null))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn({ err: error, runId, action }, "beta channel run failed");
        this.finish("failed", null, message);
      });
    return { accepted: true, runId, targetVersion: input.version ?? null, error: null };
  }

  private async execute(
    action: BetaChannelAction,
    input: { version?: string; purge?: boolean },
  ): Promise<string | null> {
    // Uninstall uses the script from the installed version's release when it is
    // still published, otherwise the newest beta's: every beta ships the same one.
    const wanted =
      action === "install" ? input.version : (this.readInstalledVersion() ?? undefined);
    let release = await fetchBetaRelease({
      env: this.env,
      fetchImpl: this.fetchImpl,
      version: wanted,
    });
    if (!release && action === "uninstall") {
      release = await fetchBetaRelease({ env: this.env, fetchImpl: this.fetchImpl });
    }
    if (!release) {
      throw new Error(
        input.version && action === "install"
          ? `no published beta release ${input.version}`
          : "no published beta release found",
      );
    }
    if (action === "install" && this.run)
      this.run = { ...this.run, targetVersion: release.version };
    const scriptName = action === "install" ? "install.sh" : "uninstall.sh";
    const asset = release.assets.find((entry) => entry.name === scriptName);
    if (!asset) throw new Error(`beta release ${release.version} has no ${scriptName}`);

    this.update("download", `downloading ${scriptName} from ${release.tagName}`);
    const script = await downloadReleaseAsset(asset, { env: this.env, fetchImpl: this.fetchImpl });

    this.update("verify", `verifying ${scriptName}`);
    const header = this.verifyScript(asset, script, action);

    const dir = await mkdtemp(path.join(this.tmpdir, `${this.beta.id}-${action}-`));
    try {
      const file = path.join(dir, scriptName);
      await writeFile(file, script, { mode: 0o700 });
      await chmod(file, 0o700);
      this.update(action, `running ${scriptName} ${release.version}`);
      await this.runScript(file, dir, this.scriptEnv(header, action, release.version, input));
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
    this.latestCache = null;
    return action === "install" ? (this.readInstalledVersion() ?? release.version) : null;
  }

  private verifyScript(
    asset: BetaReleaseAsset,
    script: Buffer,
    action: BetaChannelAction,
  ): ScriptHeader {
    const digest = asset.digest?.trim() ?? "";
    const match = /^sha256:([0-9a-f]{64})$/i.exec(digest);
    if (!match?.[1]) throw new Error(`${asset.name} has no sha256 digest on the release`);
    const actual = sha256Hex(script);
    if (actual !== match[1].toLowerCase()) {
      throw new Error(`${asset.name} checksum mismatch (expected ${match[1]}, got ${actual})`);
    }
    const header = parseScriptHeader(script.toString("utf8"));
    if (header.ID !== this.beta.id || header.APPLICATION_ID !== this.beta.applicationId) {
      throw new Error(`${asset.name} is not the ${this.beta.name} ${action} script`);
    }
    if (action === "install" && header.CHANNEL !== "beta") {
      throw new Error(`${asset.name} does not install the beta channel`);
    }
    if (header.SERVICE && header.SERVICE !== this.beta.serviceName) {
      throw new Error(`${asset.name} manages ${header.SERVICE}, not ${this.beta.serviceName}`);
    }
    return header;
  }

  private scriptEnv(
    header: ScriptHeader,
    action: BetaChannelAction,
    version: string,
    input: { purge?: boolean },
  ): NodeJS.ProcessEnv {
    const betaPrefix = header.ENV_PREFIX || `${brand.channels.stable.id.toUpperCase()}_BETA`;
    // The script reads its overrides under FROGG_* (legacy) or its own prefix. Both, and the
    // stable daemon's own prefix, are dropped: this daemon's FROGG_HOME, install dir and listen
    // address must never reach the beta install.
    const env = scrubInstallerEnv(this.env, ["FROGG", brand.envPrefix, betaPrefix]);
    const set = (suffix: string, value: string) => {
      env[`FROGG_${suffix}`] = value;
      env[`${betaPrefix}_${suffix}`] = value;
    };
    if (action === "install") set("VERSION", version);
    if (action === "uninstall" && input.purge) set("PURGE", "1");
    return env;
  }

  private runScript(file: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = this.spawnScript("bash", [file], { env, cwd });
      let tail: string[] = [];
      const onLine = (line: string) => {
        const text = line.replace(/\s+$/, "");
        if (!text) return;
        tail = [...tail.slice(-19), text];
        this.broadcastProgress(text);
      };
      if (child.stdout) createInterface({ input: child.stdout }).on("line", onLine);
      if (child.stderr) createInterface({ input: child.stderr }).on("line", onLine);
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`installer timed out after ${Math.round(this.runTimeoutMs / 1000)}s`));
      }, this.runTimeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        const last = tail.findLast((line) => /error/i.test(line)) ?? tail.at(-1);
        reject(
          new Error(
            `installer exited with ${code ?? signal ?? "unknown status"}${last ? `: ${last}` : ""}`,
          ),
        );
      });
    });
  }

  private update(phase: string, message: string): void {
    if (!this.run) return;
    this.run = { ...this.run, phase, message, at: this.now().toISOString() };
    this.broadcastProgress();
  }

  private finish(status: "succeeded" | "failed", version: string | null, error: string | null) {
    const run = this.run;
    if (!run) return;
    this.update(status === "succeeded" ? "done" : "failed", error ?? `${run.action} finished`);
    this.run = null;
    const payload: DaemonBetaChannelRunCompletedMessage["payload"] = {
      runId: run.runId,
      action: run.action,
      status,
      version,
      error,
      at: this.now().toISOString(),
    };
    this.emit({ type: "daemon.beta_channel.run.completed", payload });
  }

  private broadcastProgress(logLine?: string): void {
    if (!this.run) return;
    this.emit({
      type: "daemon.beta_channel.run.progress",
      payload: { run: this.run, ...(logLine !== undefined ? { logLine } : {}) },
    });
  }

  private emit(msg: SessionOutboundMessage): void {
    if (!this.broadcaster) return;
    try {
      this.broadcaster(msg);
    } catch (error) {
      this.logger.warn({ err: error }, "failed to broadcast beta channel progress");
    }
  }
}
