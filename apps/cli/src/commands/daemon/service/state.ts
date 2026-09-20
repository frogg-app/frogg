import { brand } from "@frogg/branding";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Who is supposed to be running the daemon on this host, and who actually is.
 *
 * An installed service unit is not proof that the unit runs the daemon: a
 * `stop` that killed the shell issuing it, a `daemon restart` (which starts a
 * detached daemon), or a hand-run `daemon start` all leave the unit inactive
 * while a daemon holds the port. The next `systemctl start` then fails with
 * EADDRINUSE, so the split has to be visible in `daemon status` rather than
 * discovered during the next upgrade.
 */
export type ServiceKind = "systemd" | "launchd";

export interface ServiceRegistration {
  kind: ServiceKind;
  /** Unit name (systemd) or job label (launchd). */
  name: string;
  /** Unit file / plist on disk. */
  path: string;
  /** Starts on login. */
  enabled: boolean;
  /** Running right now. */
  active: boolean;
}

export type ServiceOwnership =
  /** The registered service is running the daemon. */
  | "service"
  /** A daemon is running, and no service is registered to own it. */
  | "manual"
  /** A service is registered but a daemon runs outside it: the next start of the unit will hit EADDRINUSE. */
  | "detached"
  /** A service is registered and nothing is running. */
  | "service_stopped"
  /** Nothing registered and nothing running. */
  | "none";

export interface ServiceStateDeps {
  platform: NodeJS.Platform;
  fileExists(filePath: string): boolean;
  run(command: string, args: string[]): { status: number | null };
  homeDir: string;
  configHome: string;
  uid: number;
}

export function defaultServiceStateDeps(
  overrides: Partial<ServiceStateDeps> = {},
): ServiceStateDeps {
  return {
    platform: process.platform,
    fileExists: (filePath) => existsSync(filePath),
    run: (command, args) =>
      spawnSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    homeDir: os.homedir(),
    configHome: process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config"),
    uid: process.getuid?.() ?? 501,
    ...overrides,
  };
}

export function detectServiceRegistration(
  deps: ServiceStateDeps = defaultServiceStateDeps(),
): ServiceRegistration | null {
  if (deps.platform === "linux") {
    const name = brand.serviceName;
    const unitPath = path.join(deps.configHome, "systemd", "user", `${name}.service`);
    if (!deps.fileExists(unitPath)) return null;
    return {
      kind: "systemd",
      name: `${name}.service`,
      path: unitPath,
      enabled: deps.run("systemctl", ["--user", "is-enabled", "--quiet", name]).status === 0,
      active: deps.run("systemctl", ["--user", "is-active", "--quiet", name]).status === 0,
    };
  }
  if (deps.platform === "darwin") {
    const label = brand.launchdLabel;
    const plist = path.join(deps.homeDir, "Library", "LaunchAgents", `${label}.plist`);
    if (!deps.fileExists(plist)) return null;
    const printed = deps.run("launchctl", ["print", `gui/${deps.uid}/${label}`]).status === 0;
    return {
      kind: "launchd",
      name: label,
      path: plist,
      enabled: printed,
      active: printed,
    };
  }
  return null;
}

export function resolveServiceOwnership(input: {
  registration: ServiceRegistration | null;
  daemonRunning: boolean;
}): ServiceOwnership {
  const { registration, daemonRunning } = input;
  if (!registration) return daemonRunning ? "manual" : "none";
  if (registration.active) return "service";
  return daemonRunning ? "detached" : "service_stopped";
}

/** One-line summary for `daemon status`, e.g. `systemd frogg-daemon.service (enabled, inactive)`. */
export function describeServiceRegistration(registration: ServiceRegistration | null): string {
  if (!registration) return "none (daemon not managed by a service)";
  const flags = [
    registration.enabled ? "enabled" : "disabled",
    registration.active ? "active" : "inactive",
  ];
  return `${registration.kind} ${registration.name} (${flags.join(", ")})`;
}

/**
 * What the user should do about a split between the registered service and
 * the running daemon. `null` when the host is in a consistent state.
 */
export function describeOwnershipRemedy(input: {
  ownership: ServiceOwnership;
  registration: ServiceRegistration | null;
}): string | null {
  const { ownership, registration } = input;
  if (ownership === "detached" && registration) {
    const restart =
      registration.kind === "systemd"
        ? `systemctl --user restart ${registration.name}`
        : `launchctl kickstart -k gui/$(id -u)/${registration.name}`;
    return (
      `${registration.name} is installed but not running this daemon, which was started outside it. ` +
      `The service cannot start while the port is held. Hand it back with: ${brand.cliName} daemon restart ` +
      `(or ${brand.cliName} daemon stop && ${restart}).`
    );
  }
  if (ownership === "service_stopped" && registration) {
    const start =
      registration.kind === "systemd"
        ? `systemctl --user start ${registration.name}`
        : `launchctl kickstart gui/$(id -u)/${registration.name}`;
    return `${registration.name} is installed but not running. Start it with: ${start}`;
  }
  return null;
}

/**
 * True when this process runs inside the daemon's own systemd service cgroup
 * (an agent terminal, a hook, anything the daemon spawned).
 *
 * This matters for every stop of that unit: systemd kills the whole cgroup, so
 * the `systemctl stop` process and the shell that issued it are killed along
 * with the daemon, and the `start` that was meant to follow never runs. That is
 * exactly how an in-place upgrade leaves the host with no daemon at all.
 */
export function isInsideSystemdUnit(unit: string = brand.serviceName): boolean {
  try {
    return readFileSync("/proc/self/cgroup", "utf8").includes(`${unit}.service`);
  } catch {
    return false;
  }
}

export interface RestartServiceDeps {
  platform: NodeJS.Platform;
  insideUnit(unit: string): boolean;
  run(command: string, args: string[]): { status: number | null; stderr?: string };
  uid: number;
  now(): number;
}

export function defaultRestartServiceDeps(
  overrides: Partial<RestartServiceDeps> = {},
): RestartServiceDeps {
  return {
    platform: process.platform,
    insideUnit: (unit) => isInsideSystemdUnit(unit),
    run: (command, args) => {
      const result = spawnSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return {
        status: result.status,
        stderr: result.stderr ?? result.error?.message ?? "",
      };
    },
    uid: process.getuid?.() ?? 501,
    now: () => Date.now(),
    ...overrides,
  };
}

export type RestartVia = "direct" | "systemd-run";

/**
 * Restarts the registered service. When the caller lives inside the unit's own
 * cgroup the restart is handed to a transient `systemd-run --user` unit, which
 * lives outside it and therefore survives the stop; the caller is very likely
 * killed mid-call, so callers must treat a successful hand-off as final and
 * print nothing they need the user to see afterwards.
 */
export function restartService(
  registration: ServiceRegistration,
  deps: RestartServiceDeps = defaultRestartServiceDeps(),
): RestartVia {
  if (registration.kind === "launchd") {
    const target = `gui/${deps.uid}/${registration.name}`;
    const result = deps.run("launchctl", ["kickstart", "-k", target]);
    if (result.status !== 0) {
      throw new Error(`launchctl kickstart -k ${target} failed: ${result.stderr?.trim() ?? ""}`);
    }
    return "direct";
  }

  const unit = registration.name;
  if (deps.platform === "linux" && deps.insideUnit(brand.serviceName)) {
    const transient = `${brand.id}-restart-${deps.now()}`;
    const result = deps.run("systemd-run", [
      "--user",
      "--collect",
      "--quiet",
      `--unit=${transient}`,
      "--",
      "systemctl",
      "--user",
      "restart",
      unit,
    ]);
    if (result.status === 0) return "systemd-run";
    // No systemd-run (or it refused): fall through and accept that this
    // process may not survive the stop. Better a restart that kills this
    // shell than a host left with a dead unit.
  }
  const result = deps.run("systemctl", ["--user", "restart", unit]);
  if (result.status !== 0) {
    throw new Error(`systemctl --user restart ${unit} failed: ${result.stderr?.trim() ?? ""}`);
  }
  return "direct";
}

/** Starts a registered but inactive service. */
export function startService(
  registration: ServiceRegistration,
  deps: RestartServiceDeps = defaultRestartServiceDeps(),
): void {
  if (registration.kind === "launchd") {
    const target = `gui/${deps.uid}/${registration.name}`;
    const result = deps.run("launchctl", ["kickstart", target]);
    if (result.status !== 0) {
      throw new Error(`launchctl kickstart ${target} failed: ${result.stderr?.trim() ?? ""}`);
    }
    return;
  }
  const result = deps.run("systemctl", ["--user", "start", registration.name]);
  if (result.status !== 0) {
    throw new Error(
      `systemctl --user start ${registration.name} failed: ${result.stderr?.trim() ?? ""}`,
    );
  }
}
