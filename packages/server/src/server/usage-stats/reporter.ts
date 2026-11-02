import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  USAGE_STATS_SCHEMA_VERSION,
  checkUsageStatsBatch,
  mapUsageOs,
  usageEventTime,
  usageStatsEndpoint,
  type UsageEvent,
  type UsageStatsBatch,
} from "@frogg/protocol/usage-stats/events";
import type { Logger } from "pino";

/**
 * The daemon's half of opt-in usage statistics (config.json `daemon.usageStats`). With it on and
 * a brand collector set, the daemon sends `daemon_started` when it boots and `daemon_active` at
 * most once a day: its version, OS and how many providers are enabled. Nothing about sessions,
 * workspaces or users. Every batch it sends is also appended to `usage-stats.log` under the
 * daemon home, so the owner can read exactly what left the host. With the setting off or no
 * collector configured it does nothing at all, and turning it off deletes the install id.
 */
export const USAGE_STATS_STATE_FILE = "usage-stats.json";
export const USAGE_STATS_LOG_FILE = "usage-stats.log";
const LOG_KEEP = 50;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

interface ReporterState {
  installId: string;
  lastActiveDay?: string;
}

export interface UsageStatsReporterDeps {
  froggHome: string;
  version: string;
  product: string;
  collectorUrl: string | null;
  isEnabled(): boolean;
  enabledProviders(): number;
  logger: Pick<Logger, "debug" | "warn">;
  fetch?: typeof fetch;
  now?: () => Date;
  platform?: NodeJS.Platform;
}

export interface UsageStatsReporter {
  start(): void;
  /** Called when `usageStats` changes. */
  setEnabled(enabled: boolean): void;
  stop(): void;
  /** Exposed for tests: sends what is due now. */
  tick(reason: "boot" | "check"): Promise<UsageStatsBatch | null>;
}

export function createUsageStatsReporter(deps: UsageStatsReporterDeps): UsageStatsReporter {
  const endpoint = usageStatsEndpoint(deps.collectorUrl);
  const now = deps.now ?? (() => new Date());
  const doFetch = deps.fetch ?? fetch;
  const statePath = path.join(deps.froggHome, USAGE_STATS_STATE_FILE);
  const logPath = path.join(deps.froggHome, USAGE_STATS_LOG_FILE);
  let timer: ReturnType<typeof setInterval> | null = null;
  let booted = false;

  const readState = (): ReporterState => {
    try {
      const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Partial<ReporterState>;
      if (typeof parsed.installId === "string") return parsed as ReporterState;
    } catch {
      // Missing or unreadable: start a fresh id.
    }
    return { installId: randomUUID() };
  };
  const writeState = (state: ReporterState) => {
    mkdirSync(deps.froggHome, { recursive: true });
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  };
  const appendLog = (batch: UsageStatsBatch) => {
    const previous = existsSync(logPath)
      ? readFileSync(logPath, "utf8").split("\n").filter(Boolean)
      : [];
    const lines = [...previous, JSON.stringify(batch)].slice(-LOG_KEEP);
    writeFileSync(logPath, lines.join("\n") + "\n");
  };

  const tick = async (reason: "boot" | "check"): Promise<UsageStatsBatch | null> => {
    if (!endpoint || !deps.isEnabled()) return null;
    const state = readState();
    const at = now();
    const day = at.toISOString().slice(0, 10);
    const providers = Math.min(deps.enabledProviders(), 100_000);
    const events: UsageEvent[] = [];
    if (reason === "boot") {
      events.push({ name: "daemon_started", at: usageEventTime(at), props: { providers } });
    }
    if (state.lastActiveDay !== day) {
      events.push({ name: "daemon_active", at: usageEventTime(at), props: { providers } });
    }
    if (events.length === 0) return null;
    const batch = checkUsageStatsBatch({
      schema: USAGE_STATS_SCHEMA_VERSION,
      installId: state.installId,
      source: "daemon",
      client: {
        product: deps.product,
        version: deps.version,
        os: mapUsageOs(deps.platform ?? process.platform),
      },
      sentAt: at.toISOString(),
      events,
    });
    if (!batch) {
      deps.logger.warn("usage statistics batch failed its schema; not sent");
      return null;
    }
    try {
      const response = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        deps.logger.debug({ status: response.status }, "usage statistics not accepted");
        return null;
      }
    } catch (error) {
      deps.logger.debug({ err: error }, "usage statistics send failed");
      return null;
    }
    // The setting may have been turned off while the request was in flight.
    if (!deps.isEnabled()) return null;
    writeState({ installId: state.installId, lastActiveDay: day });
    appendLog(batch);
    return batch;
  };

  const startTimer = () => {
    if (timer || !endpoint) return;
    timer = setInterval(() => void tick("check"), CHECK_INTERVAL_MS);
    timer.unref?.();
  };
  const stopTimer = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  return {
    start() {
      if (!endpoint || !deps.isEnabled()) return;
      booted = true;
      void tick("boot");
      startTimer();
    },
    setEnabled(enabled) {
      if (!endpoint) return;
      if (!enabled) {
        stopTimer();
        rmSync(statePath, { force: true });
        return;
      }
      void tick(booted ? "check" : "boot");
      booted = true;
      startTimer();
    },
    stop: stopTimer,
    tick,
  };
}
