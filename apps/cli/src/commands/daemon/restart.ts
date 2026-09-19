import type { Command } from "commander";
import {
  resolveLocalDaemonState,
  startLocalDaemonDetached,
  stopLocalDaemon,
  DEFAULT_STOP_TIMEOUT_MS,
  type DaemonStartOptions,
} from "./local-daemon.js";
import {
  detectServiceRegistration,
  resolveServiceOwnership,
  restartService,
  type ServiceRegistration,
} from "./service/state.js";
import type {
  CommandOptions,
  SingleResult,
  OutputSchema,
  CommandError,
} from "../../output/index.js";

interface RestartResult {
  action: "restarted";
  home: string;
  pid: string;
  message: string;
}

/**
 * Restarting by hand used to mean "stop the pid in the lock file, start a
 * detached daemon" even on a host whose daemon belongs to a systemd unit or
 * launch agent. That silently moved the daemon out from under its service:
 * the unit went inactive, the next `systemctl start` (an upgrade, a reboot
 * script) hit EADDRINUSE, and nothing said so. When a service owns this
 * install, restart it instead.
 *
 * Explicit overrides are the exception: a unit cannot honour a different
 * home, listen address or relay flag, so those keep the manual path.
 */
function serviceCanHandleRestart(options: DaemonStartOptions): boolean {
  return (
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

async function restartThroughService(
  registration: ServiceRegistration,
  timeoutMs: number,
): Promise<RestartCommandResult> {
  const ownership = resolveServiceOwnership({
    registration,
    daemonRunning: resolveLocalDaemonState({}).running,
  });
  let before = "not running";
  if (ownership === "detached") {
    // The unit is idle while a hand-started daemon holds the port; it has to
    // go before the unit can bind.
    const stopped = await stopLocalDaemon({ timeoutMs, force: true });
    before = stopped.pid === null ? "not running" : `PID ${stopped.pid}`;
  } else if (ownership === "service") {
    before = "service";
  }
  const via = restartService(registration);
  return {
    type: "single",
    data: {
      action: "restarted",
      home: resolveLocalDaemonState({}).home,
      pid: "-",
      message:
        via === "systemd-run"
          ? `Restarting ${registration.name} from a transient unit (this shell is inside the daemon cgroup and may be terminated)`
          : `Restarted ${registration.name} (${before})`,
    },
    schema: restartResultSchema,
  };
}

const restartResultSchema: OutputSchema<RestartResult> = {
  idField: "action",
  columns: [
    {
      header: "STATUS",
      field: "action",
      color: () => "green",
    },
    { header: "HOME", field: "home" },
    { header: "PID", field: "pid" },
    { header: "MESSAGE", field: "message" },
  ],
};

export type RestartCommandResult = SingleResult<RestartResult>;

function parseTimeoutMs(raw: unknown): number {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_STOP_TIMEOUT_MS;
  }

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    const error: CommandError = {
      code: "INVALID_TIMEOUT",
      message: `Invalid timeout value: ${raw}`,
      details: "Timeout must be a positive number of seconds",
    };
    throw error;
  }

  return Math.ceil(seconds * 1000);
}

function toStartOptions(options: CommandOptions): DaemonStartOptions {
  const startOptions: DaemonStartOptions = {
    home: typeof options.home === "string" ? options.home : undefined,
    listen: typeof options.listen === "string" ? options.listen : undefined,
    port: typeof options.port === "string" ? options.port : undefined,
    relay: typeof options.relay === "boolean" ? options.relay : undefined,
    mcp: typeof options.mcp === "boolean" ? options.mcp : undefined,
    injectMcp: typeof options.injectMcp === "boolean" ? options.injectMcp : undefined,
    webUi: typeof options.webUi === "boolean" ? options.webUi : undefined,
    hostnames: typeof options.hostnames === "string" ? options.hostnames : undefined,
  };

  if (startOptions.listen && startOptions.port) {
    const error: CommandError = {
      code: "INVALID_OPTIONS",
      message: "Cannot use --listen and --port together",
    };
    throw error;
  }

  return startOptions;
}

export async function runRestartCommand(
  options: CommandOptions,
  _command: Command,
): Promise<RestartCommandResult> {
  const timeoutMs = parseTimeoutMs(options.timeout);
  const force = options.force === true;
  const startOptions = toStartOptions(options);

  const registration = serviceCanHandleRestart(startOptions) ? detectServiceRegistration() : null;
  if (registration) {
    try {
      return await restartThroughService(registration, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const error: CommandError = {
        code: "RESTART_FAILED",
        message: `Failed to restart ${registration.name}: ${message}`,
      };
      throw error;
    }
  }

  try {
    let stopResult: Awaited<ReturnType<typeof stopLocalDaemon>>;
    try {
      stopResult = await stopLocalDaemon({
        home: startOptions.home,
        timeoutMs,
        force,
      });
    } catch (err) {
      const isTimeout =
        err instanceof Error && err.message.includes("Timed out waiting for daemon PID");
      if (!force && isTimeout) {
        stopResult = await stopLocalDaemon({
          home: startOptions.home,
          timeoutMs,
          force: true,
        });
      } else {
        throw err;
      }
    }

    const startup = await startLocalDaemonDetached(startOptions);
    const before = stopResult.pid === null ? "not running" : `PID ${stopResult.pid}`;
    const after = startup.pid === null ? "unknown PID" : `PID ${startup.pid}`;

    return {
      type: "single",
      data: {
        action: "restarted",
        home: stopResult.home,
        pid: startup.pid === null ? "-" : String(startup.pid),
        message: `Local daemon restarted (${before} -> ${after})`,
      },
      schema: restartResultSchema,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const error: CommandError = {
      code: "RESTART_FAILED",
      message: `Failed to restart local daemon: ${message}`,
    };
    throw error;
  }
}
