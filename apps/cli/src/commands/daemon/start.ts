import { brand } from "@frogg/branding";
import { Command, Option } from "commander";
import chalk from "chalk";
import { prepareFroggHome } from "@frogg/server";
import {
  resolveLocalDaemonDiagnosticState,
  startLocalDaemonForeground,
  startLocalDaemonDetached,
  type DaemonStartOptions as StartOptions,
} from "./local-daemon.js";
import { getErrorMessage } from "../../utils/errors.js";
import {
  detectServiceRegistration,
  startService,
  type ServiceRegistration,
} from "./service/state.js";

export type { DaemonStartOptions as StartOptions } from "./local-daemon.js";

type RawStartCommandOptions = StartOptions & {
  allowedHosts?: string;
};

export function startCommand(): Command {
  return new Command("start")
    .description(`Start the local ${brand.name} daemon`)
    .option("--listen <listen>", "Listen target (host:port, port, or unix socket path)")
    .option("--port <port>", `Port to listen on (default: ${brand.daemonPort})`)
    .option("--home <path>", `${brand.name} home directory (default: ~/${brand.homeDir})`)
    .option("--foreground", "Run in foreground (don't daemonize)")
    .option("--relay", "Enable relay connection")
    .option("--no-relay", "Disable relay connection")
    .option("--relay-use-tls", "Use wss:// for the relay connection and pairing offers")
    .option("--no-mcp", "Disable the Agent MCP HTTP endpoint")
    .option("--no-inject-mcp", `Disable auto-injecting the ${brand.name} MCP into created agents`)
    .option("--web-ui", "Enable the bundled daemon web UI")
    .option("--no-web-ui", "Disable the bundled daemon web UI")
    .option(
      "--hostnames <hosts>",
      'Daemon hostnames (comma-separated, e.g. "myhost,.example.com" or "true" for any)',
    )
    .addOption(new Option("--allowed-hosts <hosts>").hideHelp())
    .action(async (options: RawStartCommandOptions) => {
      await runStart({
        ...options,
        hostnames: options.hostnames ?? options.allowedHosts,
      });
    });
}

/**
 * On a host where a service unit owns the daemon, a bare `daemon start` used
 * to start a *detached* daemon instead: the unit stayed inactive, and the next
 * time anything started it (an upgrade, a reboot) the port was already taken.
 * Start the service itself, so the daemon comes back under the manager that is
 * supposed to keep it alive.
 *
 * Any explicit override (a different home, listen address or relay flag) is
 * something the unit's baked-in environment cannot honour, so those still get
 * a hand-started daemon.
 */
function serviceCanHandleStart(options: StartOptions): boolean {
  return (
    options.foreground !== true &&
    options.home === undefined &&
    options.listen === undefined &&
    options.port === undefined &&
    options.relay === undefined &&
    options.mcp === undefined &&
    options.injectMcp === undefined &&
    options.webUi === undefined &&
    options.hostnames === undefined
  );
}

export interface StartRuntime {
  resolveState(options: {
    home?: string;
  }): Pick<ReturnType<typeof resolveLocalDaemonDiagnosticState>, "running" | "pidInfo">;
  startDetached: typeof startLocalDaemonDetached;
  startForeground: typeof startLocalDaemonForeground;
  prepareHome?(options: { home?: string }): void;
  detectService?(): ServiceRegistration | null;
  startService?(registration: ServiceRegistration): void;
  log(message: string): void;
  error(message: string): void;
  exit(code: number): never;
}

const defaultRuntime: StartRuntime = {
  resolveState: resolveLocalDaemonDiagnosticState,
  startDetached: startLocalDaemonDetached,
  startForeground: startLocalDaemonForeground,
  prepareHome: (options) => {
    if (!options.home) prepareFroggHome();
  },
  detectService: detectServiceRegistration,
  startService,
  log: console.log,
  error: console.error,
  exit: process.exit,
};

export async function runStart(
  options: StartOptions,
  runtime: StartRuntime = defaultRuntime,
): Promise<void> {
  if (options.listen && options.port) {
    runtime.error(chalk.red("Cannot use --listen and --port together"));
    runtime.exit(1);
  }

  runtime.prepareHome?.({ home: options.home });
  if (reportAlreadyRunning(options, runtime)) return;

  if (startThroughService(options, runtime)) return;

  if (!options.foreground) {
    try {
      const startup = await runtime.startDetached(options);
      runtime.log(chalk.green(`Daemon starting in background (PID ${startup.pid ?? "unknown"}).`));
      runtime.log(chalk.dim(`Logs: ${startup.logPath}`));
    } catch (err) {
      // Another start may win the race after the initial check.
      if (reportAlreadyRunning(options, runtime)) return;
      exitWithError(getErrorMessage(err), runtime);
    }
    return;
  }
  try {
    const status = await runtime.startForeground(options);
    if (status !== 0 && reportAlreadyRunning(options, runtime)) return;
    runtime.exit(status);
  } catch (err) {
    const message = getErrorMessage(err);
    exitWithError(`Failed to start daemon: ${message}`, runtime);
  }
}

/** Returns true when the registered service was started and nothing else should run. */
function startThroughService(options: StartOptions, runtime: StartRuntime): boolean {
  if (!serviceCanHandleStart(options)) return false;
  const registration = runtime.detectService?.() ?? null;
  if (!registration || registration.active) return false;
  try {
    runtime.startService?.(registration);
  } catch (err) {
    runtime.error(chalk.red(`Failed to start ${registration.name}: ${getErrorMessage(err)}`));
    runtime.error(
      chalk.dim(
        `Start a daemon outside the service with: ${brand.cliName} daemon start --foreground`,
      ),
    );
    runtime.exit(1);
  }
  runtime.log(chalk.green(`Started ${registration.name}.`));
  return true;
}

function reportAlreadyRunning(options: StartOptions, runtime: StartRuntime): boolean {
  const state = runtime.resolveState({ home: options.home });
  if (!state.running || !state.pidInfo) return false;
  runtime.log(`Daemon already running (PID ${state.pidInfo.pid}).`);
  return true;
}

function exitWithError(message: string, runtime: StartRuntime): never {
  runtime.error(chalk.red(message));
  runtime.exit(1);
}
