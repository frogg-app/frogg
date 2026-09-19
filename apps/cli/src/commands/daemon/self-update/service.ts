import { brand } from "@frogg/branding";
import { spawn, spawnSync } from "node:child_process";
import { openSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveLocalDaemonState, stopLocalDaemon } from "../local-daemon.js";
import { bundleLauncherPath } from "./bundle.js";
import { appendSelfUpdateLog, currentLinkPath } from "./layout.js";
import { isInsideSystemdUnit } from "../service/state.js";

/**
 * How the daemon gets restarted after `current` is flipped. The installer
 * registers a systemd user unit on Linux or a launchd agent on macOS; a
 * `FROGG_NO_SERVICE=1` install, Windows, or a hand-started daemon falls back to
 * the CLI's own stop/start through the pid-lock contract.
 */
export const SYSTEMD_UNIT = brand.serviceName;
export const LAUNCHD_LABEL = brand.launchdLabel;

export type ServiceKind = "systemd" | "launchd" | "unmanaged";

export interface ServiceManager {
  kind: ServiceKind;
  restart(): Promise<void>;
  isRunning(): Promise<boolean>;
  /**
   * Stops and disables leftover services of the pre-rename product that
   * compete for this daemon's listen address. `force` retires them even when
   * their configured port cannot be matched (the verifier already saw a
   * foreign daemon on the port). Returns what was retired.
   */
  retireConflictingServices?(options?: { force?: boolean }): Promise<string[]>;
}

// COMPAT(fdeRename): before 0.8 the product was FDE and installed its own
// service. When both are registered on one port, every restart hands the port
// to whichever supervisor retries first, and each product's updater then sees
// the other's version. Remove with legacy-fde-migration.ts.
export const LEGACY_SYSTEMD_UNITS = ["fde-daemon"];
export const LEGACY_LAUNCHD_LABELS = ["app.frogg.fde-daemon"];

export interface LegacyServiceDeps {
  platform: NodeJS.Platform;
  /** Our listen address (`host:port`), or null when unknown. */
  listen: string | null;
  readFile(filePath: string): string | null;
  run(command: string, args: string[]): { status: number | null; stderr: string };
  homeDir: string;
  configHome: string;
  uid: number;
  log(line: string): void;
}

function listenPort(listen: string | null | undefined): string | null {
  if (!listen) return null;
  const match = /:(\d+)\s*$/.exec(listen.trim());
  return match ? match[1]! : null;
}

/**
 * `force` (a foreign daemon was seen on our port) still spares a legacy
 * service whose configured port is known to differ: it cannot be the holder.
 */
function legacyServiceConflicts(contents: string, ourPort: string | null, force: boolean): boolean {
  const configured = /\b(?:FDE|FROGG)_LISTEN=("?)([^"\s<]+)\1/.exec(contents)?.[2] ?? null;
  const theirPort =
    listenPort(configured) ??
    listenPort(/<key>(?:FDE|FROGG)_LISTEN<\/key>\s*<string>([^<]+)<\/string>/.exec(contents)?.[1]);
  if (force) return theirPort === null || ourPort === null || theirPort === ourPort;
  return ourPort !== null && theirPort === ourPort;
}

export async function retireLegacyServices(
  deps: LegacyServiceDeps,
  options: { force?: boolean } = {},
): Promise<string[]> {
  const ourPort = listenPort(deps.listen);
  const retired: string[] = [];
  if (deps.platform === "linux") {
    for (const unit of LEGACY_SYSTEMD_UNITS) {
      const file = path.join(deps.configHome, "systemd", "user", `${unit}.service`);
      const contents = deps.readFile(file);
      if (contents === null) continue;
      if (!legacyServiceConflicts(contents, ourPort, options.force === true)) continue;
      const active = deps.run("systemctl", ["--user", "is-active", "--quiet", unit]).status === 0;
      const enabled = deps.run("systemctl", ["--user", "is-enabled", "--quiet", unit]).status === 0;
      if (!active && !enabled) continue;
      deps.log(
        `stopping and disabling legacy service ${unit}.service: it competes for ${
          deps.listen ?? "this daemon's port"
        } (unit file left at ${file})`,
      );
      const result = deps.run("systemctl", ["--user", "disable", "--now", `${unit}.service`]);
      if (result.status === 0) retired.push(`${unit}.service`);
      else deps.log(`could not disable ${unit}.service: ${result.stderr.trim()}`);
    }
  } else if (deps.platform === "darwin") {
    for (const label of LEGACY_LAUNCHD_LABELS) {
      const file = path.join(deps.homeDir, "Library", "LaunchAgents", `${label}.plist`);
      const contents = deps.readFile(file);
      if (contents === null) continue;
      if (!legacyServiceConflicts(contents, ourPort, options.force === true)) continue;
      const target = `gui/${deps.uid}/${label}`;
      deps.log(`stopping and disabling legacy launch agent ${label}: it competes for this port`);
      deps.run("launchctl", ["disable", target]);
      deps.run("launchctl", ["bootout", target]);
      retired.push(label);
    }
  }
  return retired;
}

function defaultLegacyServiceDeps(options: ServiceOptions | undefined): LegacyServiceDeps {
  return {
    platform: options?.platform ?? process.platform,
    listen: options?.listen ?? null,
    readFile: (filePath) => {
      try {
        return readFileSync(filePath, "utf8");
      } catch {
        return null;
      }
    },
    run,
    homeDir: os.homedir(),
    configHome: process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config"),
    uid: process.getuid?.() ?? 501,
    log: (line) => {
      if (options) appendSelfUpdateLog(options.installDir, line);
    },
  };
}

export interface ServiceOptions {
  installDir: string;
  home: string | undefined;
  listen: string | null;
  platform: NodeJS.Platform;
}

/** Historical name; the same options now describe every service kind. */
export type UnmanagedServiceOptions = ServiceOptions;

/**
 * The parts of "who currently owns the running daemon" that a managed service
 * manager has to consult, injected so the reconciliation can be tested without
 * a systemd or launchd host.
 */
export interface OwnershipDeps {
  /** True when the registered unit itself is running the daemon. */
  isUnitActive(): Promise<boolean>;
  /** True when the pid lock under `home` names a live daemon process. */
  isDaemonRunning(): boolean;
  /** Graceful stop through the pid lock (RPC, then signal). */
  stopDaemon(): Promise<void>;
  log(line: string): void;
}

export type OwnershipOutcome = "unit_active" | "no_daemon" | "stopped_unowned_daemon";

/**
 * An installed unit that targets this install is not proof that the unit is
 * running the daemon: the unit can sit inactive while someone has started the
 * daemon by hand. Starting the inactive unit in that state hits the running
 * daemon's idempotent start, which succeeds without moving the daemon onto the
 * newly linked version. Hand the unit an unowned daemon by stopping it first,
 * so the restart genuinely starts the new code.
 */
export async function reconcileDaemonOwnership(deps: OwnershipDeps): Promise<OwnershipOutcome> {
  if (await deps.isUnitActive()) return "unit_active";
  if (!deps.isDaemonRunning()) return "no_daemon";
  deps.log(
    "service unit is inactive while a daemon is running outside it; stopping that daemon so the unit can take ownership",
  );
  await deps.stopDaemon();
  return "stopped_unowned_daemon";
}

function ownershipDeps(
  options: ServiceOptions | undefined,
  isUnitActive: () => Promise<boolean>,
  overrides: Partial<OwnershipDeps> | undefined,
): OwnershipDeps {
  return {
    isUnitActive,
    isDaemonRunning: () => resolveLocalDaemonState({ home: options?.home }).running,
    stopDaemon: async () => {
      // `stopService` stays off: the unit is inactive, and the daemon to
      // displace is the hand-started one the pid lock names.
      await stopLocalDaemon({ home: options?.home, force: true });
    },
    log: (line: string) => {
      if (options) appendSelfUpdateLog(options.installDir, line);
    },
    ...overrides,
  };
}

function run(command: string, args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) return { status: null, stderr: result.error.message };
  return { status: result.status, stderr: result.stderr ?? "" };
}

export function systemdUnitPath(env: NodeJS.ProcessEnv = process.env): string {
  const configHome = env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  return path.join(configHome, "systemd", "user", `${SYSTEMD_UNIT}.service`);
}

export function launchdPlistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
}

export function createSystemdServiceManager(
  options?: ServiceOptions,
  overrides?: Partial<OwnershipDeps>,
): ServiceManager {
  const isRunning = async () =>
    run("systemctl", ["--user", "is-active", "--quiet", SYSTEMD_UNIT]).status === 0;
  const deps = ownershipDeps(options, isRunning, overrides);
  return {
    kind: "systemd",
    async restart() {
      await reconcileDaemonOwnership(deps);
      const result = run("systemctl", ["--user", "restart", SYSTEMD_UNIT]);
      if (result.status !== 0) {
        throw new Error(`systemctl --user restart ${SYSTEMD_UNIT} failed: ${result.stderr.trim()}`);
      }
    },
    isRunning,
    retireConflictingServices: (retire) =>
      retireLegacyServices(defaultLegacyServiceDeps(options), retire),
  };
}

export function createLaunchdServiceManager(
  options?: ServiceOptions,
  overrides?: Partial<OwnershipDeps>,
): ServiceManager {
  const target = `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`;
  const isRunning = async () => run("launchctl", ["print", target]).status === 0;
  const deps = ownershipDeps(options, isRunning, overrides);
  return {
    kind: "launchd",
    async restart() {
      await reconcileDaemonOwnership(deps);
      const result = run("launchctl", ["kickstart", "-k", target]);
      if (result.status !== 0) {
        throw new Error(`launchctl kickstart -k ${target} failed: ${result.stderr.trim()}`);
      }
    },
    isRunning,
    retireConflictingServices: (retire) =>
      retireLegacyServices(defaultLegacyServiceDeps(options), retire),
  };
}

/**
 * No service manager: stop through the pid lock (graceful RPC, then signal),
 * then start `<installDir>/current/bin/frogg daemon start` detached so the
 * freshly linked version comes up with the same home and listen address.
 */
export function createUnmanagedServiceManager(options: UnmanagedServiceOptions): ServiceManager {
  const launcher = bundleLauncherPath(
    currentLinkPath(options.installDir),
    options.platform === "win32" ? "win" : "linux",
  );
  return {
    kind: "unmanaged",
    async restart() {
      await stopLocalDaemon({ home: options.home, force: true });
      const args = ["daemon", "start"];
      if (options.home) args.push("--home", options.home);
      if (options.listen) args.push("--listen", options.listen);
      const child = spawn(launcher, args, {
        detached: true,
        stdio: "ignore",
        shell: options.platform === "win32",
        env: {
          ...process.env,
          ...(options.home ? { [`${brand.envPrefix}_HOME`]: options.home } : {}),
        },
      });
      // `daemon start` daemonizes and exits 0 once the child survives its
      // startup grace; a non-zero exit (or a launcher that cannot run at all)
      // is the broken-bundle signal the rollback path relies on.
      type Exit = { code: number | null; error?: Error } | null;
      const exit = await Promise.race<Exit>([
        new Promise<Exit>((resolve) => setTimeout(() => resolve(null), 4000).unref()),
        new Promise<Exit>((resolve) =>
          child.once("error", (error) => resolve({ code: null, error })),
        ),
        new Promise<Exit>((resolve) => child.once("exit", (code) => resolve({ code }))),
      ]);
      child.unref();
      if (exit && exit.code !== 0) {
        throw new Error(
          `${launcher} daemon start exited with ${exit.error?.message ?? exit.code ?? "an error"}`,
        );
      }
    },
    async isRunning() {
      const state = resolveLocalDaemonState({ home: options.home });
      return state.running;
    },
    retireConflictingServices: (retire) =>
      retireLegacyServices(defaultLegacyServiceDeps(options), retire),
  };
}

/**
 * True when the service definition at `filePath` launches `<installDir>/current`.
 * A unit that belongs to another install (a developer's real daemon while a
 * scratch install is under test) must never be restarted on its behalf.
 */
export function serviceFileTargetsInstall(filePath: string, installDir: string): boolean {
  try {
    const content = readFileSync(filePath, "utf8");
    const launcher = path.join(installDir, "current", "bin", brand.cliName);
    return (
      content.includes(launcher) || content.includes(`${brand.envPrefix}_INSTALL_DIR=${installDir}`)
    );
  } catch {
    return false;
  }
}

export function detectServiceManager(options: UnmanagedServiceOptions): ServiceManager {
  if (
    options.platform === "linux" &&
    serviceFileTargetsInstall(systemdUnitPath(), options.installDir)
  ) {
    return createSystemdServiceManager(options);
  }
  if (
    options.platform === "darwin" &&
    serviceFileTargetsInstall(launchdPlistPath(), options.installDir)
  ) {
    return createLaunchdServiceManager(options);
  }
  return createUnmanagedServiceManager(options);
}

const SUPERVISOR_ENV_KEYS = [
  "FROGG_EXECUTION_SERVICE",
  ...["HOME", "INSTALL_DIR", "RELEASE_BASE", "RELEASES_API", "GITHUB_TOKEN"].map(
    (key) => `${brand.envPrefix}_${key}`,
  ),
  "PATH",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "XDG_CONFIG_HOME",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "FROGG_HOME",
  "FROGG_LISTEN",
  "FROGG_WEB_UI_ENABLED",
  "FROGG_INSTALL_DIR",
  "FROGG_HOME",
  "FROGG_RELEASE_BASE",
  "FROGG_RELEASES_API",
  "FROGG_GITHUB_TOKEN",
];

/**
 * Starts the apply step in a process that outlives the daemon. Inside the
 * systemd unit a plain detached child would still be in the service cgroup
 * and die with the restart, so it becomes a transient `systemd-run --user`
 * unit instead; elsewhere `detached` (setsid) plus the caller exiting is
 * enough for the child to be re-parented away from the daemon's tree.
 */
export function spawnDetachedSupervisor(input: {
  execPath: string;
  cliEntry: string;
  args: string[];
  logPath: string;
  env?: NodeJS.ProcessEnv;
}): { pid: number | null; via: "systemd-run" | "detached" } {
  const env = input.env ?? process.env;
  if (process.platform === "linux" && isInsideSystemdUnit()) {
    const unit = `${brand.id}-self-update-${Date.now()}`;
    const setenv = SUPERVISOR_ENV_KEYS.filter((key) => env[key] !== undefined).map(
      (key) => `--setenv=${key}=${env[key]}`,
    );
    const result = spawnSync(
      "systemd-run",
      [
        "--user",
        "--collect",
        "--quiet",
        `--unit=${unit}`,
        `--property=StandardOutput=append:${input.logPath}`,
        `--property=StandardError=append:${input.logPath}`,
        ...setenv,
        "--",
        input.execPath,
        input.cliEntry,
        ...input.args,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (result.status !== 0) {
      throw new Error(
        `systemd-run failed: ${(result.stderr ?? result.error?.message ?? "").trim()}`,
      );
    }
    return { pid: null, via: "systemd-run" };
  }
  const log = openSync(input.logPath, "a");
  const child = spawn(input.execPath, [input.cliEntry, ...input.args], {
    detached: true,
    stdio: ["ignore", log, log],
    env,
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid ?? null, via: "detached" };
}
