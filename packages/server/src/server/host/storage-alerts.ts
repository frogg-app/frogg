import type pino from "pino";
import type {
  MutableStorageAlertsConfig,
  StorageAlert,
  StorageAlertLevel,
} from "@frogg/protocol/messages";
import {
  CLEANABLE_STORAGE_CATEGORIES,
  isStorageCategoryId,
  type OwnedStorageReport,
  type OwnedStorageService,
} from "./owned-storage.js";

/**
 * Watches the total size of the storage Frogg owns and raises a level when it
 * passes the thresholds in `daemon.storage.alerts`. The level is a step
 * function of one measurement, so it is reported on a change rather than on
 * every sample: a client notifies once when storage grows and once when a
 * cleanup brings it back.
 */

const LEVEL_RANK: Record<StorageAlertLevel, number> = {
  ok: 0,
  warn: 1,
  critical: 2,
};
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
/** Let a daemon finish starting before the first (disk-bound) measurement. */
const DEFAULT_INITIAL_DELAY_MS = 5 * 60 * 1000;

export function isAtOrAbove(level: StorageAlertLevel, threshold: StorageAlertLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[threshold];
}

/** Ordered so a critical threshold at or below the warning one still reads as critical. */
export function levelForBytes(
  bytes: number,
  alerts: MutableStorageAlertsConfig,
): StorageAlertLevel {
  const critical = Math.max(alerts.criticalBytes, alerts.warnBytes);
  if (bytes >= critical) return "critical";
  if (bytes >= alerts.warnBytes) return "warn";
  return "ok";
}

export function evaluateStorageAlert(
  report: OwnedStorageReport,
  alerts: MutableStorageAlertsConfig,
): StorageAlert {
  const present = report.categories.filter((category) => category.exists);
  const totalBytes = present.reduce((sum, category) => sum + category.bytes, 0);
  const reclaimableBytes = present.reduce(
    (sum, category) =>
      sum +
      (isStorageCategoryId(category.id) && CLEANABLE_STORAGE_CATEGORIES.has(category.id)
        ? (category.reclaimableBytes ?? 0)
        : 0),
    0,
  );
  return {
    // Alerts off is still a measurement; it just never reaches a level.
    level: alerts.enabled ? levelForBytes(totalBytes, alerts) : "ok",
    totalBytes,
    truncated: present.some((category) => category.truncated),
    reclaimableBytes,
    warnBytes: alerts.warnBytes,
    criticalBytes: Math.max(alerts.criticalBytes, alerts.warnBytes),
    computedAt: report.computedAt,
  };
}

/** English push/notification text; the in-app banner localises the same numbers itself. */
export function formatStorageAlertNotification(
  alert: StorageAlert,
  hostLabel: string,
): { title: string; body: string } {
  const size = formatGib(alert.totalBytes);
  const reclaimable = formatGib(alert.reclaimableBytes);
  return {
    title:
      alert.level === "critical"
        ? `Storage is very large on ${hostLabel}`
        : `Storage is growing on ${hostLabel}`,
    body:
      alert.reclaimableBytes > 0
        ? `${size} in use, ${reclaimable} of it reclaimable by clearing stale worktrees and agent storage.`
        : `${size} in use.`,
  };
}

function formatGib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}

export interface StorageAlertMonitorOptions {
  storage: Pick<OwnedStorageService, "list">;
  getAlerts: () => MutableStorageAlertsConfig;
  /** Called only when the level changes, with the level it replaces. */
  onLevelChange: (alert: StorageAlert, previousLevel: StorageAlertLevel) => void;
  intervalMs?: number;
  initialDelayMs?: number;
  logger: pino.Logger;
}

export class StorageAlertMonitor {
  private level: StorageAlertLevel = "ok";
  private latest: StorageAlert | null = null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly options: StorageAlertMonitorOptions) {}

  /** The last measured alert, or null before the first measurement. */
  current(): StorageAlert | null {
    return this.latest;
  }

  start(): void {
    if (this.timer) return;
    const intervalMs = this.options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const initialDelayMs = this.options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    const tick = () => void this.check();
    this.timer = setTimeout(() => {
      tick();
      this.timer = setInterval(tick, intervalMs);
      this.timer.unref?.();
    }, initialDelayMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Measures now and reports a level change. Overlapping calls collapse: a
   * cleanup that finishes mid-measurement is picked up by the next one.
   */
  async check(options: { refresh?: boolean } = {}): Promise<StorageAlert | null> {
    if (this.running) return this.latest;
    this.running = true;
    try {
      const report = await this.options.storage.list({
        refresh: options.refresh,
      });
      const alert = evaluateStorageAlert(report, this.options.getAlerts());
      this.latest = alert;
      if (alert.level !== this.level) {
        const previousLevel = this.level;
        this.level = alert.level;
        this.options.onLevelChange(alert, previousLevel);
      }
      return alert;
    } catch (error) {
      this.options.logger.warn({ err: error }, "Storage alert measurement failed");
      return this.latest;
    } finally {
      this.running = false;
    }
  }
}
