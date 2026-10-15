import { brand } from "@frogg/branding";
import path from "node:path";

const brandEnvKey = (suffix: string) => `${brand.envPrefix}_${suffix}`;

/**
 * What "start Frogg when I log in" means on each platform, as data: a file to
 * write and commands to run. Pure — the caller supplies the home directory,
 * environment, and the command that starts the daemon — so the generated unit,
 * plist, and Windows command line are all testable against a scratch home.
 *
 * The Linux unit is the one `deploy/install.sh` writes, ported here so a host
 * that was set up by hand gets the same service as one set up by the installer.
 */
export const SERVICE_NAME = brand.serviceName;
export const LAUNCHD_LABEL = brand.launchdLabel;
/**
 * The per-user Run key value that starts the daemon at login on Windows. It is
 * the brand's service slug, so it never contains a space.
 */
export const WINDOWS_RUN_VALUE = brand.serviceName;
export const WINDOWS_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/**
 * Earlier builds registered an ONLOGON scheduled task under this name. Creating
 * one needs an elevated prompt, so on a normal account it failed silently and
 * nothing started at login; it is only removed now, never created.
 */
export const LEGACY_WINDOWS_TASK_NAME = `${brand.name} Daemon`;
export const DEFAULT_SERVICE_LISTEN = `${brand.daemon.bindHost}:${brand.daemonPort}`;

export type ServicePlatform = "linux" | "darwin" | "win32";

export interface ServiceCommand {
  program: string;
  args: string[];
  /** A failure is expected on some machines (clearing a registration that may not exist). */
  optional?: boolean;
  /** Pass `args` to the Windows process untouched, for `cmd.exe /s /c` quoting. */
  verbatim?: boolean;
}

export interface ServicePlanInput {
  platform: ServicePlatform;
  /** The user's home directory (`os.homedir()` in production). */
  homeDir: string;
  env: NodeJS.ProcessEnv;
  /** How to start the daemon in the foreground. */
  command: ServiceCommand;
  listen: string;
  /** Only explicit launch overrides should mask future config.json edits. */
  persistListen?: boolean;
  /** Written into the unit as `FROGG_HOME` when the caller pinned one. */
  froggHome?: string;
  /** Prepended to the service's PATH so agent CLIs stay visible to the daemon. */
  pathPrepend?: string;
}

export interface ServiceFile {
  path: string;
  contents: string;
}

export interface ServicePlan {
  platform: ServicePlatform;
  label: string;
  /** The unit, plist or Windows launcher script to write. */
  file: ServiceFile | null;
  /** Commands that register and start the service, in order; any non-optional failure fails the install. */
  install: ServiceCommand[];
  /** Commands that stop and deregister it, in order. Failures are tolerated. */
  uninstall: ServiceCommand[];
  /** Shown after a successful install; empty when there is nothing to add. */
  hints: string[];
}

/** One argument for a `.cmd` line: always quoted, with `%` doubled so nothing expands. */
function batchQuote(value: string): string {
  if (value.includes('"') || /[\r\n]/.test(value)) {
    throw new Error(`Cannot start the daemon at login from a path containing quotes: ${value}`);
  }
  return `"${value.replaceAll("%", "%%")}"`;
}

function windowsLauncherPath(input: ServicePlanInput): string {
  const home = input.froggHome ?? path.join(input.homeDir, brand.homeDir);
  return path.join(home, "service", `${WINDOWS_RUN_VALUE}.cmd`);
}

/**
 * The script the Run key points at. A Run value is capped near 260 characters
 * and has no quoting rules worth trusting, so the full command line (node, the
 * CLI entry, `--home`, `--listen`) lives here and the value is just this path.
 */
function windowsLauncher(input: ServicePlanInput): string {
  const line = ["call", ...[input.command.program, ...input.command.args].map(batchQuote)].join(
    " ",
  );
  return `@echo off\r
rem Starts the ${brand.name} daemon when you log in. Written by: ${brand.cliName} daemon install-service\r
${line}\r
`;
}

function systemdUnitPath(input: ServicePlanInput): string {
  const configHome = input.env.XDG_CONFIG_HOME?.trim() || path.join(input.homeDir, ".config");
  return path.join(configHome, "systemd", "user", `${SERVICE_NAME}.service`);
}

function servicePath(input: ServicePlanInput): string {
  const prepend = input.pathPrepend?.trim();
  const inherited = input.env.PATH ?? "";
  return prepend ? `${prepend}:${inherited}` : inherited;
}

function unitQuote(value: string): string {
  return (
    '"' +
    value
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"')
      .replaceAll("%", "%%")
      .replaceAll("\n", "\\n")
      .replaceAll("\r", "\\r") +
    '"'
  );
}
function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function systemdUnit(input: ServicePlanInput): string {
  const exec = [input.command.program, ...input.command.args].map(unitQuote).join(" ");
  const home = input.froggHome
    ? `Environment=${unitQuote(`${brand.envPrefix}_HOME=${input.froggHome}`)}\n`
    : "";
  const execution = input.env.FROGG_EXECUTION_SERVICE === "1";
  const executionEnv = execution ? "Environment=FROGG_EXECUTION_SERVICE=1\n" : "";
  const killMode = execution ? "process" : "mixed";
  let stop = "";
  if (execution) {
    const startIndex = input.command.args.lastIndexOf("start");
    if (startIndex < 0)
      throw new Error("Independent execution service requires a daemon start command");
    const stopArgs = [...input.command.args.slice(0, startIndex), "stop", "--force"];
    const stopExec = [input.command.program, ...stopArgs].map(unitQuote).join(" ");
    stop = `ExecStop=${stopExec}\n`;
  }
  return `[Unit]
Description=${brand.name} daemon (${brand.fullName})
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${exec}
${stop}${input.persistListen === false ? "" : `Environment=${brandEnvKey("LISTEN")}=${input.listen}\n`}Environment=${brandEnvKey("WEB_UI_ENABLED")}=true
Environment=${unitQuote(`PATH=${servicePath(input)}`)}
${home}${executionEnv}Restart=on-failure
RestartSec=5
KillMode=${killMode}
TimeoutStopSec=30

[Install]
WantedBy=default.target
`;
}

function plistEntry(key: string, value: string): string {
  return `    <key>${xml(key)}</key><string>${xml(value)}</string>\n`;
}

function launchdPlist(input: ServicePlanInput): string {
  const programArguments = [input.command.program, ...input.command.args]
    .map((part) => `    <string>${xml(part)}</string>`)
    .join("\n");
  const logPath = path.join(input.homeDir, "Library", "Logs", `${LAUNCHD_LABEL}.log`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${input.persistListen === false ? "" : plistEntry(brandEnvKey("LISTEN"), input.listen)}${plistEntry(
    brandEnvKey("WEB_UI_ENABLED"),
    "true",
  )}${plistEntry("PATH", servicePath(input))}${
    input.froggHome ? plistEntry(`${brand.envPrefix}_HOME`, input.froggHome) : ""
  }  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${xml(logPath)}</string>
  <key>StandardErrorPath</key><string>${xml(logPath)}</string>
</dict>
</plist>
`;
}

export function resolveServicePlan(input: ServicePlanInput): ServicePlan {
  if (input.platform === "linux") {
    const unitPath = systemdUnitPath(input);
    return {
      platform: "linux",
      label: SERVICE_NAME,
      file: { path: unitPath, contents: systemdUnit(input) },
      install: [
        { program: "systemctl", args: ["--user", "daemon-reload"], optional: true },
        { program: "systemctl", args: ["--user", "enable", SERVICE_NAME] },
        { program: "systemctl", args: ["--user", "restart", SERVICE_NAME] },
      ],
      uninstall: [
        {
          program: "systemctl",
          args: ["--user", "disable", "--now", SERVICE_NAME],
        },
        { program: "systemctl", args: ["--user", "daemon-reload"] },
      ],
      hints: [
        "To keep the daemon running after you log out: sudo loginctl enable-linger $(id -un)",
      ],
    };
  }

  if (input.platform === "darwin") {
    const plistPath = path.join(input.homeDir, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    const domain = `gui/${input.env.UID ?? process.getuid?.() ?? ""}`;
    return {
      platform: "darwin",
      label: LAUNCHD_LABEL,
      file: { path: plistPath, contents: launchdPlist(input) },
      install: [
        // Clears a previous registration; fails on a clean machine.
        { program: "launchctl", args: ["bootout", domain, plistPath], optional: true },
        { program: "launchctl", args: ["bootstrap", domain, plistPath] },
      ],
      uninstall: [{ program: "launchctl", args: ["bootout", domain, plistPath] }],
      hints: [],
    };
  }

  const launcher = windowsLauncherPath(input);
  const removeLegacyTask: ServiceCommand = {
    program: "schtasks",
    args: ["/Delete", "/TN", LEGACY_WINDOWS_TASK_NAME, "/F"],
    optional: true,
  };
  return {
    platform: "win32",
    label: WINDOWS_RUN_VALUE,
    file: { path: launcher, contents: windowsLauncher(input) },
    install: [
      removeLegacyTask,
      {
        program: "reg",
        args: [
          "add",
          WINDOWS_RUN_KEY,
          "/v",
          WINDOWS_RUN_VALUE,
          "/t",
          "REG_SZ",
          "/d",
          `"${launcher}"`,
          "/f",
        ],
      },
      // Start it now too. `/s` strips the outer quotes and keeps the inner pair
      // around the path; Node would escape them, so the line is passed verbatim.
      { program: "cmd.exe", args: ["/d", "/s", "/c", `""${launcher}""`], verbatim: true },
    ],
    uninstall: [
      {
        program: "reg",
        args: ["delete", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE, "/f"],
        optional: true,
      },
      removeLegacyTask,
    ],
    hints: [
      `A daemon that was already running keeps its settings until: ${brand.cliName} daemon restart`,
    ],
  };
}
