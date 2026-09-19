import { brand } from "@frogg/branding";
import { normalizeBrandEnvironment } from "@frogg/branding/identity";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createFroggDaemon } from "./bootstrap.js";
import { findLegacyAccountProviderIds, loadConfig } from "./config.js";
import { parseDaemonCliOverrides } from "./daemon-cli-overrides.js";
import { getExecutionServiceStatus } from "./execution-service/client.js";
import { createGatewayDaemon } from "./execution-service/gateway-daemon.js";
import { resolveFroggHome } from "./frogg-home.js";
import { createRootLogger } from "./logger.js";
import type { DaemonLifecycleIntent } from "./bootstrap.js";
import { getProcessDiagnostics } from "./process-diagnostics.js";
import {
  findEnabledHomeModeProviders,
  findEnabledUnverifiedProviders,
} from "@frogg/protocol/provider-accounts";
import { loadPersistedConfig } from "./persisted-config.js";
import { describePortHolder, findPortHolder, isAddressInUse } from "./port-holder.js";

process.title = `${brand.name} Daemon`;

type SupervisorLifecycleMessage =
  | {
      type: "frogg:shutdown";
      reason: string;
    }
  | {
      type: "frogg:ready";
      listen: string;
    }
  | {
      type: "frogg:restart";
      reason?: string;
    }
  | {
      type: "frogg:listen-failed";
      listen: string;
      message: string;
    };

interface BootstrapResult {
  froggHome: string;
  logger: ReturnType<typeof createRootLogger>;
  config: ReturnType<typeof loadConfig>;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function writeWorkerLifecycleLog(
  froggHome: string,
  message: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    const logPath = path.join(froggHome, "daemon.log");
    mkdirSync(path.dirname(logPath), { recursive: true });
    appendFileSync(
      logPath,
      `${JSON.stringify({
        level: "warn",
        time: new Date().toISOString(),
        pid: process.pid,
        name: "DaemonWorker",
        msg: message,
        ...fields,
      })}\n`,
      "utf8",
    );
  } catch {
    // Exit-reason logging must never prevent the worker from exiting.
  }
}

function warnOnLegacyAccountProviders(
  config: BootstrapResult["config"],
  logger: BootstrapResult["logger"],
): void {
  const providerIds = findLegacyAccountProviderIds(config.providerOverrides);
  if (providerIds.length === 0) return;
  logger.warn(
    { providerIds },
    "Ignoring provider entries that use the removed Claude multi-account provider params. " +
      "Recreate these accounts under Settings > Providers > Provider sign-ins, then delete the " +
      "stale provider entries from config.json.",
  );
}

/**
 * Provider account manifests for everything but `claude` are unverified guesses
 * at that CLI's config directory and credential files. They are inert while
 * disabled, so the moment worth saying so is when a config override turns one
 * on.
 */
function warnOnUnverifiedProviderAccounts(
  froggHome: string,
  logger: BootstrapResult["logger"],
): void {
  let providerIds: string[] = [];
  try {
    providerIds = findEnabledUnverifiedProviders(loadPersistedConfig(froggHome).providerAccounts);
  } catch {
    // A config that cannot be read is reported by the normal config load path.
    return;
  }
  if (providerIds.length === 0) return;
  logger.warn(
    { providerIds },
    "Provider accounts are enabled for providers whose config directory and credential files " +
      "are unverified guesses. Sign-in may write to the wrong directory or report the wrong " +
      "state. Verify the entry in the provider account capability manifest against the CLI " +
      "before relying on it.",
  );
}

/**
 * Home-mode providers are verified, but enabling one changes how its CLI is
 * launched: it runs with the account directory as HOME. Worth saying out loud
 * once at startup, because anything the CLI reads from the home directory and
 * is not in the capability's `homeLinks` will be missing.
 */
function warnOnHomeModeProviderAccounts(
  froggHome: string,
  logger: BootstrapResult["logger"],
): void {
  let providerIds: string[] = [];
  try {
    providerIds = findEnabledHomeModeProviders(loadPersistedConfig(froggHome).providerAccounts);
  } catch {
    return;
  }
  if (providerIds.length === 0) return;
  logger.warn(
    { providerIds },
    "Provider accounts are enabled for providers that have no config-directory environment " +
      "variable, so each account runs its CLI with the account directory as HOME. Only the " +
      "capability's homeLinks entries (npm cache, git and SSH config, gcloud config) are " +
      "linked back to the real home; anything else the CLI reads from home will be absent.",
  );
}

function bootstrapFromEnvironment(): BootstrapResult {
  try {
    normalizeBrandEnvironment(brand, process.env);
    const froggHome = resolveFroggHome();
    const config = loadConfig(froggHome, { cli: parseDaemonCliOverrides(process.argv.slice(2)) });
    const logger = createRootLogger({ log: config.log }, { froggHome, file: false });
    warnOnLegacyAccountProviders(config, logger);
    warnOnUnverifiedProviderAccounts(froggHome, logger);
    warnOnHomeModeProviderAccounts(froggHome, logger);
    return { froggHome, logger, config };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}

async function main() {
  const { froggHome, logger, config } = bootstrapFromEnvironment();
  let daemon: Pick<
    Awaited<ReturnType<typeof createFroggDaemon>>,
    "start" | "stop" | "getListenTarget"
  > | null = null;
  let shutdownPromise: Promise<number> | null = null;
  let exitHookInstalled = false;

  const installExitHook = () => {
    if (exitHookInstalled || !shutdownPromise) {
      return;
    }
    exitHookInstalled = true;
    void shutdownPromise.then((exitCode) => {
      process.exit(exitCode);
    });
  };

  const beginShutdown = (
    signal: string,
    options?: {
      reason?: string;
      successExitCode?: number;
    },
  ) => {
    const reason = options?.reason ?? `worker_received_${signal}`;
    if (!shutdownPromise) {
      logger.info(
        { signal, reason, ...getProcessDiagnostics() },
        `${signal} received, shutting down gracefully...`,
      );

      shutdownPromise = (async () => {
        const forceExit = setTimeout(() => {
          logger.warn(
            { signal, reason, ...getProcessDiagnostics() },
            "Forcing shutdown - HTTP server didn't close in time",
          );
          process.exit(1);
        }, 25000); // Under systemd TimeoutStopSec=30; leaves room to persist interrupted-turn markers.

        try {
          if (!daemon) {
            logger.error("Shutdown requested before daemon initialization completed");
            clearTimeout(forceExit);
            return 1;
          }
          await daemon.stop();
          clearTimeout(forceExit);
          logger.info("Server closed");
          return options?.successExitCode ?? 0;
        } catch (err) {
          clearTimeout(forceExit);
          logger.error({ err }, "Shutdown failed");
          return 1;
        }
      })();
    } else {
      logger.info(
        { signal, reason, ...getProcessDiagnostics() },
        `${signal} received while shutdown is already in progress`,
      );
    }

    installExitHook();
  };

  const sendSupervisorLifecycleMessage = (message: SupervisorLifecycleMessage): boolean => {
    if (typeof process.send !== "function") {
      return false;
    }
    try {
      process.send(message);
      return true;
    } catch (err) {
      logger.error({ err, message }, "Failed to send lifecycle IPC message to supervisor");
      return false;
    }
  };

  const handleLifecycleIntent = (intent: DaemonLifecycleIntent) => {
    if (intent.type === "shutdown") {
      logger.warn(
        { clientId: intent.clientId, requestId: intent.requestId, reason: intent.reason },
        "Shutdown requested via websocket",
      );
      if (sendSupervisorLifecycleMessage({ type: "frogg:shutdown", reason: intent.reason })) {
        return;
      }
      beginShutdown("shutdown lifecycle intent", { reason: intent.reason });
      return;
    }

    logger.warn(
      { clientId: intent.clientId, requestId: intent.requestId, reason: intent.reason },
      "Restart requested via websocket",
    );
    if (
      sendSupervisorLifecycleMessage({
        type: "frogg:restart",
        ...(intent.reason ? { reason: intent.reason } : {}),
      })
    ) {
      return;
    }
    beginShutdown("restart lifecycle intent", {
      reason: intent.reason,
      successExitCode: 0,
    });
  };

  const installSupervisorLivenessGuard = () => {
    if (typeof process.send !== "function") {
      return;
    }

    const supervisorPid = process.ppid;
    let lastSupervisorHeartbeatAt = Date.now();
    let supervisorExitRequested = false;
    const exitAfterSupervisorLoss = (reason: string) => {
      if (supervisorExitRequested) {
        return;
      }
      supervisorExitRequested = true;

      writeWorkerLifecycleLog(froggHome, "Supervisor liveness lost; worker exiting", {
        reason,
        ...getProcessDiagnostics(),
        supervisorPid,
        currentParentPid: process.ppid,
        ipcConnected: typeof process.connected === "boolean" ? process.connected : null,
        heartbeatAgeMs: Date.now() - lastSupervisorHeartbeatAt,
      });

      // The supervisor owns the worker's stdout/stderr pipes. Once it is gone,
      // logging during graceful shutdown can block on the broken pipe and leave
      // the daemon orphaned, so supervisor loss is a hard process boundary.
      process.exit(0);
    };

    process.on("message", (message: unknown) => {
      if (typeof message !== "object" || message === null || !("type" in message)) {
        return;
      }
      const type = (message as { type?: unknown }).type;
      if (type === "frogg:supervisor-heartbeat") {
        lastSupervisorHeartbeatAt = Date.now();
        return;
      }
      if (type === "frogg:graceful-shutdown") {
        const reason = (message as { reason?: unknown }).reason;
        beginShutdown("Supervisor shutdown request", {
          reason: typeof reason === "string" ? reason : "supervisor_requested_shutdown",
        });
      }
    });
    process.on("disconnect", () => exitAfterSupervisorLoss("ipc_disconnect_event"));

    const timer = setInterval(() => {
      const ipcConnected = typeof process.connected === "boolean" ? process.connected : true;
      const heartbeatExpired = Date.now() - lastSupervisorHeartbeatAt > 3500;
      const supervisorChanged = process.ppid !== supervisorPid;

      if (ipcConnected === false) {
        exitAfterSupervisorLoss("ipc_disconnected");
        return;
      }
      if (supervisorChanged) {
        exitAfterSupervisorLoss("supervisor_parent_pid_changed");
        return;
      }
      if (heartbeatExpired && !isPidAlive(supervisorPid)) {
        exitAfterSupervisorLoss("supervisor_pid_dead");
      }
    }, 1000);
    timer.unref();
  };

  installSupervisorLivenessGuard();

  try {
    // Retained execution remains authoritative even if a subsequent launcher omits the opt-in.
    const independent =
      process.env.FROGG_EXECUTION_SERVICE === "1" ||
      (await getExecutionServiceStatus(froggHome)) !== null;
    daemon = independent
      ? await createGatewayDaemon(config, logger, handleLifecycleIntent)
      : await createFroggDaemon(
          {
            ...config,
            onLifecycleIntent: handleLifecycleIntent,
          },
          logger,
        );
  } catch (err) {
    logger.fatal({ err }, "Daemon bootstrap failed");
    throw err;
  }

  try {
    await daemon.start();
    const listenTarget = daemon.getListenTarget();
    const listen =
      listenTarget?.type === "tcp"
        ? `${listenTarget.host}:${listenTarget.port}`
        : listenTarget?.path;
    if (!listen) {
      throw new Error("Daemon did not expose a listen target after startup");
    }
    sendSupervisorLifecycleMessage({ type: "frogg:ready", listen });
  } catch (err) {
    if (isAddressInUse(err)) {
      // Name the holder: a leftover worker, the pre-rename FDE service or an
      // unrelated program. The supervisor backs off and repeats this line.
      const failure = err as { address?: unknown; port?: unknown };
      const host = typeof failure.address === "string" ? failure.address : "127.0.0.1";
      const port = typeof failure.port === "number" ? failure.port : NaN;
      if (Number.isFinite(port)) {
        const holder = await findPortHolder(host, port);
        const message = `${brand.name} cannot listen on ${host}:${port}: ${describePortHolder(holder)}`;
        logger.fatal({ err, holder }, message);
        sendSupervisorLifecycleMessage({
          type: "frogg:listen-failed",
          listen: `${host}:${port}`,
          message,
        });
        throw err;
      }
    }
    logger.fatal({ err }, "Daemon failed to start listening");
    throw err;
  }

  process.on("SIGTERM", () => beginShutdown("SIGTERM"));
  process.on("SIGINT", () => beginShutdown("SIGINT"));

  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception — daemon crashing");
    exitAfterPinoFlush();
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "Unhandled promise rejection — daemon crashing");
    exitAfterPinoFlush();
  });
}

// Give pino async streams a moment to flush the fatal log entry to daemon.log
// before the process exits. Without this, the last few entries that explain
// why the daemon crashed can be lost.
function exitAfterPinoFlush(): void {
  setTimeout(() => process.exit(1), 200);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  exitAfterPinoFlush();
});
