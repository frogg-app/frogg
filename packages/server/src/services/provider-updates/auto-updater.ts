/**
 * Background poller that keeps provider CLIs current.
 *
 * Checking runs on an interval and is on by default; installing is only done
 * when the user has opted into `providerUpdates.autoUpdate`, because replacing
 * a provider binary under a running session is their call, not ours.
 */

import type { Logger } from "pino";

import type { ProviderUpdatesConfig } from "../../server/persisted-config.js";
import { resolveProviderUpdatePreferences } from "./preferences.js";
import type { ProviderUpdateService, ProviderUpdateSnapshot } from "./service.js";

const DEFAULT_CHECK_INTERVAL_MINUTES = 12 * 60;
// Let the daemon finish booting before competing for the network.
const INITIAL_DELAY_MS = 30_000;

export interface ProviderAutoUpdaterOptions {
  logger: Logger;
  service: ProviderUpdateService;
  /** Read fresh on every tick so config edits take effect without a restart. */
  getConfig: () => ProviderUpdatesConfig | undefined;
  onSnapshot?: (snapshot: ProviderUpdateSnapshot) => void;
  initialDelayMs?: number;
}

export class ProviderAutoUpdater {
  private readonly logger: Logger;
  private readonly service: ProviderUpdateService;
  private readonly getConfig: () => ProviderUpdatesConfig | undefined;
  private readonly onSnapshot: ((snapshot: ProviderUpdateSnapshot) => void) | undefined;
  private readonly initialDelayMs: number;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private running = false;

  constructor(options: ProviderAutoUpdaterOptions) {
    this.logger = options.logger.child({ module: "provider-auto-updater" });
    this.service = options.service;
    this.getConfig = options.getConfig;
    this.onSnapshot = options.onSnapshot;
    this.initialDelayMs = options.initialDelayMs ?? INITIAL_DELAY_MS;
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.schedule(this.initialDelayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private intervalMs(config: ProviderUpdatesConfig | undefined): number {
    const minutes = config?.checkIntervalMinutes ?? DEFAULT_CHECK_INTERVAL_MINUTES;
    return minutes * 60 * 1000;
  }

  /** Exposed for tests and for an explicit "check now" from the client. */
  async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    const config = this.getConfig();
    try {
      if (!resolveProviderUpdatePreferences(config).checkEnabled) {
        return;
      }
      const ignored = new Set(config?.ignoredProviders ?? []);
      // Background checks only ask the registry about providers on this host.
      const snapshot = await this.service.check({ forceRefresh: true, installedOnly: true });
      this.onSnapshot?.(snapshot);

      if (config?.autoUpdate !== true) {
        return;
      }
      for (const entry of snapshot.entries) {
        if (entry.status !== "update-available" || !entry.updatable) continue;
        if (ignored.has(entry.provider)) continue;
        const result = await this.service.update(entry.provider);
        if (result.error) {
          this.logger.warn({ provider: entry.provider, err: result.error }, "auto-update failed");
        } else if (result.updated) {
          this.logger.info(
            {
              provider: entry.provider,
              from: result.previousVersion,
              to: result.installedVersion,
            },
            "auto-updated provider",
          );
        }
      }
    } catch (error) {
      this.logger.warn({ err: error }, "provider update check failed");
    } finally {
      this.running = false;
      this.schedule(this.intervalMs(config));
    }
  }
}
