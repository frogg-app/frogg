import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type pino from "pino";
import type { DaemonAutoUpdateConfig, DaemonUpdateLastResult } from "@frogg/protocol/messages";
import type { DaemonUpdateService } from "./daemon-update-service.js";

/**
 * Opt-in scheduled self-update (`daemon.autoUpdate` / `FROGG_AUTO_UPDATE=1`).
 * Checks the release channel on the configured interval and, when a newer
 * version exists, runs the same self-update path a client would; while
 * agents are running the attempt is deferred instead of interrupting them.
 * Rollback protects against a daemon that fails to come up, not against a UI
 * regression: the web UI ships inside the desktop app, not the daemon.
 */
export const DEFAULT_AUTO_UPDATE_CONFIG: DaemonAutoUpdateConfig = {
  enabled: false,
  channel: "stable",
  checkIntervalHours: 24,
  quietHours: null,
};

const INITIAL_DELAY_MS = 5 * 60_000;
const DEFER_WHILE_BUSY_MS = 15 * 60_000;
/** Longest wait between automatic attempts at the same unapplied version. */
export const MAX_AUTO_UPDATE_BACKOFF_MS = 7 * 24 * 3_600_000;

/**
 * Automatic attempts at one version, persisted because every failed attempt
 * restarts the daemon (and rolls back), so in-memory counters would reset.
 */
export interface AutoUpdateAttemptState {
  version: string;
  attempts: number;
  lastAttemptAt: string;
}

export interface AutoUpdateAttemptStore {
  read(): AutoUpdateAttemptState | null;
  write(state: AutoUpdateAttemptState | null): void;
}

export function createFileAutoUpdateAttemptStore(
  froggHome: string,
  logger?: pino.Logger,
): AutoUpdateAttemptStore {
  const file = path.join(froggHome, "daemon-update", "auto-update-attempts.json");
  return {
    read() {
      try {
        const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<AutoUpdateAttemptState>;
        if (
          typeof raw.version !== "string" ||
          typeof raw.attempts !== "number" ||
          !Number.isFinite(raw.attempts) ||
          raw.attempts < 1 ||
          typeof raw.lastAttemptAt !== "string"
        ) {
          return null;
        }
        return {
          version: raw.version,
          attempts: Math.floor(raw.attempts),
          lastAttemptAt: raw.lastAttemptAt,
        };
      } catch {
        return null;
      }
    },
    write(state) {
      try {
        if (!state) {
          rmSync(file, { force: true });
          return;
        }
        mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, `${JSON.stringify(state)}\n`);
        renameSync(tmp, file);
      } catch (error) {
        logger?.warn({ err: error }, "auto-update: could not persist attempt state");
      }
    },
  };
}

/**
 * Wait before automatic attempt `attempts + 1` at a version: one check
 * interval after the first failure, doubling per failure, capped.
 */
export function autoUpdateBackoffMs(attempts: number, checkIntervalHours: number): number {
  const base = Math.max(1, checkIntervalHours) * 3_600_000;
  const exponent = Math.min(Math.max(0, attempts - 1), 20);
  return Math.min(base * 2 ** exponent, Math.max(base, MAX_AUTO_UPDATE_BACKOFF_MS));
}

export interface DaemonAutoUpdaterOptions {
  service: Pick<DaemonUpdateService, "check" | "start" | "currentRun" | "installInfo">;
  getConfig: () => DaemonAutoUpdateConfig | undefined;
  hasRunningAgents: () => boolean;
  /**
   * The last recorded apply outcome (`last-update.json`). A failed attempt at a
   * version is not retried until a full check interval has passed: every
   * attempt restarts the daemon, and without this the restart's initial-delay
   * tick would retry the same broken version every few minutes.
   */
  lastResult?: () => DaemonUpdateLastResult | null;
  /**
   * Persisted count of automatic attempts per version, for exponential
   * backoff across the restarts each failed attempt causes. Manual updates
   * from a client bypass the auto-updater and are never blocked by it.
   */
  attempts?: AutoUpdateAttemptStore;
  logger: pino.Logger;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
}

export function isInQuietHours(
  now: Date,
  quietHours: [number, number] | null | undefined,
): boolean {
  if (!quietHours) return false;
  const [start, end] = quietHours;
  if (start === end) return false;
  const hour = now.getHours();
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export type AutoUpdateTickOutcome =
  | "disabled"
  | "not_updatable"
  | "quiet_hours"
  | "up_to_date"
  | "busy"
  | "already_running"
  | "started"
  | "backed_off"
  | "check_failed";

/** What the last scheduled check did, and when the next one is due. */
export interface AutoUpdateCheckRecord {
  at: string;
  outcome: AutoUpdateTickOutcome;
  nextCheckAt: string;
}

export class DaemonAutoUpdater {
  private readonly options: DaemonAutoUpdaterOptions;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private lastCheckRecord: AutoUpdateCheckRecord | null = null;

  constructor(options: DaemonAutoUpdaterOptions) {
    this.options = options;
  }

  start(): void {
    this.stopped = false;
    this.schedule(INITIAL_DELAY_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      (this.options.clearTimer ?? clearTimeout)(this.timer);
      this.timer = null;
    }
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) (this.options.clearTimer ?? clearTimeout)(this.timer);
    const setTimer = this.options.setTimer ?? setTimeout;
    this.timer = setTimer(() => {
      this.timer = null;
      void this.runScheduledTick();
    }, ms);
    this.timer.unref?.();
  }

  /**
   * The last scheduled check. A check that finds nothing used to be silent,
   * so a host sitting on an old version looked identical to one whose
   * auto-update had stopped running: the only way to tell was an "auto-update
   * starting" line that never came. Every tick now leaves a record.
   */
  lastCheck(): AutoUpdateCheckRecord | null {
    return this.lastCheckRecord;
  }

  private async runScheduledTick(): Promise<void> {
    let outcome: AutoUpdateTickOutcome = "check_failed";
    try {
      outcome = await this.tick();
    } catch (error) {
      this.options.logger.warn({ err: error }, "auto-update tick failed");
    }
    const config = this.options.getConfig() ?? DEFAULT_AUTO_UPDATE_CONFIG;
    const deferred = outcome === "busy" || outcome === "quiet_hours";
    const nextInMs = deferred
      ? DEFER_WHILE_BUSY_MS
      : Math.max(1, config.checkIntervalHours) * 3_600_000;
    const now = this.currentTime();
    this.lastCheckRecord = {
      at: now.toISOString(),
      outcome,
      nextCheckAt: new Date(now.getTime() + nextInMs).toISOString(),
    };
    this.options.logger.info(
      {
        outcome,
        channel: config.channel,
        nextCheckAt: this.lastCheckRecord.nextCheckAt,
      },
      "auto-update checked",
    );
    this.schedule(nextInMs);
  }

  private currentTime(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** Automatic attempts at `version` that have not (yet) applied. */
  private priorAttempts(version: string): AutoUpdateAttemptState | null {
    const store = this.options.attempts;
    const last = this.options.lastResult?.() ?? null;
    let prior = store?.read() ?? null;
    if (prior && prior.version !== version) {
      // A newer (or different) release replaces the one that kept failing.
      prior = null;
      store?.write(null);
    }
    const lastForVersion = last && last.to === version ? last : null;
    if (lastForVersion?.status === "applied") return null;
    if (!prior && lastForVersion) {
      // Daemons without the attempt store recorded only last-update.json.
      return { version, attempts: 1, lastAttemptAt: lastForVersion.at };
    }
    return prior;
  }

  private isBackedOff(
    version: string,
    prior: AutoUpdateAttemptState | null,
    now: number,
    checkIntervalHours: number,
  ): boolean {
    if (!prior) return false;
    const retryAt =
      Date.parse(prior.lastAttemptAt) + autoUpdateBackoffMs(prior.attempts, checkIntervalHours);
    if (!Number.isFinite(retryAt) || now >= retryAt) return false;
    const last = this.options.lastResult?.() ?? null;
    this.options.logger.info(
      {
        version,
        attempts: prior.attempts,
        retryAt: new Date(retryAt).toISOString(),
        lastStatus: last?.to === version ? last.status : null,
        reason: last?.to === version ? last.reason : null,
      },
      "auto-update backed off: earlier attempts at this version did not apply",
    );
    return true;
  }

  async tick(): Promise<AutoUpdateTickOutcome> {
    const config = this.options.getConfig() ?? DEFAULT_AUTO_UPDATE_CONFIG;
    const log = this.options.logger;
    if (!config.enabled) return "disabled";
    if (!this.options.service.installInfo.updatable) return "not_updatable";
    if (isInQuietHours(this.currentTime(), config.quietHours)) {
      return "quiet_hours";
    }
    if (this.options.service.currentRun()) return "already_running";
    const check = await this.options.service.check({ channel: config.channel });
    if (check.error) {
      log.warn({ error: check.error }, "auto-update check failed");
      return "check_failed";
    }
    const attemptStore = this.options.attempts;
    if (!check.updateAvailable || !check.latestVersion) {
      // Up to date, including after a successful attempt: start fresh.
      if (attemptStore?.read()) attemptStore.write(null);
      return "up_to_date";
    }
    const version = check.latestVersion;
    const now = this.currentTime().getTime();
    const prior = this.priorAttempts(version);
    if (this.isBackedOff(version, prior, now, config.checkIntervalHours)) return "backed_off";
    if (this.options.hasRunningAgents()) {
      log.info({ version: check.latestVersion }, "auto-update deferred: agents are running");
      return "busy";
    }
    log.info(
      {
        from: check.currentVersion,
        to: version,
        attempt: (prior?.attempts ?? 0) + 1,
      },
      "auto-update starting",
    );
    const started = await this.options.service.start({
      version,
      channel: config.channel,
    });
    if (!started.accepted) {
      log.warn({ error: started.error }, "auto-update could not start");
      return "already_running";
    }
    // Recorded before the restart this attempt causes; cleared once a check
    // finds the daemon up to date.
    attemptStore?.write({
      version,
      attempts: (prior?.attempts ?? 0) + 1,
      lastAttemptAt: new Date(now).toISOString(),
    });
    return "started";
  }
}
