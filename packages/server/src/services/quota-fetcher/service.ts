import type { Logger } from "pino";
import type { ProviderUsage } from "../../server/messages.js";
import { createProviderUsageFetchers } from "./manifest.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "./provider.js";
import { ProviderRateLimitedError, unavailableUsage } from "./usage.js";

export interface ProviderUsageServiceOptions {
  logger: Logger;
  fetchers?: ProviderUsageFetcher[];
  fetch?: ProviderApiFetch;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface ProviderUsageListResult {
  fetchedAt: string;
  providers: ProviderUsage[];
}

const DEFAULT_PROVIDER_USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * No caller can make the daemon ask a provider about one sign-in more often
 * than this — not a hover, not an agent finishing, not a forced refresh. Every
 * composer on screen can ask for "fresh" figures at once; this is what keeps
 * that from turning into one provider call each.
 */
export const MIN_PROVIDER_USAGE_MAX_AGE_MS = 30 * 1000;
/** Backoff after a 429 with no usable Retry-After, doubling per repeat. */
const RATE_LIMIT_BASE_COOLDOWN_MS = 60 * 1000;
const RATE_LIMIT_MAX_COOLDOWN_MS = 15 * 60 * 1000;

interface UsageEntry {
  fetchedAtMs: number;
  usage: ProviderUsage;
  /** Last answer that was not an error, served while the provider holds us off. */
  lastGood: ProviderUsage | null;
  /** No fetch for this entry before this time, whatever the caller asks for. */
  cooldownUntilMs: number;
  consecutiveRateLimits: number;
}

export class ProviderUsageService {
  private readonly logger: Logger;
  private readonly fetchers: ProviderUsageFetcher[];
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  /**
   * Keyed per provider and config directory, never per request: a request
   * scoped to one Claude account must not re-read Codex, and every request that
   * leaves Claude unscoped must share one read of the default sign-in. Two
   * sign-ins of one provider still get separate entries, because serving one's
   * figures for the other is the bug the account scoping exists to prevent.
   */
  private readonly entries = new Map<string, UsageEntry>();
  private readonly inFlight = new Map<string, Promise<UsageEntry>>();

  constructor(options: ProviderUsageServiceOptions) {
    this.logger = options.logger.child({ module: "provider-usage-service" });
    this.fetchers =
      options.fetchers ??
      createProviderUsageFetchers({
        logger: this.logger,
        fetch: options.fetch,
      });
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_PROVIDER_USAGE_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * @param options.configDirs config directory to read per provider id, for
   * providers whose credentials live in a redirectable directory. A provider
   * absent from the map is read the way it always was.
   */
  async listUsage(options?: {
    /** Treated as `maxAgeMs: 0`: still floored, still subject to cooldowns. */
    forceRefresh?: boolean;
    /** The oldest cached result the caller accepts; floored at MIN_PROVIDER_USAGE_MAX_AGE_MS. */
    maxAgeMs?: number;
    configDirs?: Readonly<Record<string, string>>;
  }): Promise<ProviderUsageListResult> {
    const configDirs = options?.configDirs ?? {};
    const requestedMaxAgeMs = options?.forceRefresh ? 0 : options?.maxAgeMs;
    const maxAgeMs =
      requestedMaxAgeMs === undefined
        ? this.cacheTtlMs
        : Math.min(this.cacheTtlMs, Math.max(requestedMaxAgeMs, MIN_PROVIDER_USAGE_MAX_AGE_MS));

    const entries = await Promise.all(
      this.fetchers.map((fetcher) =>
        this.readEntry(fetcher, configDirs[fetcher.providerId], maxAgeMs),
      ),
    );
    // The oldest figure in the answer is how fresh the answer is.
    const fetchedAtMs = Math.min(...entries.map((entry) => entry.fetchedAtMs), this.now());
    return {
      fetchedAt: new Date(fetchedAtMs).toISOString(),
      providers: entries.map((entry) => entry.usage),
    };
  }

  private async readEntry(
    fetcher: ProviderUsageFetcher,
    configDir: string | undefined,
    maxAgeMs: number,
  ): Promise<UsageEntry> {
    const key = `${fetcher.providerId}\u0000${configDir ?? ""}`;
    const nowMs = this.now();
    const cached = this.entries.get(key);
    if (cached && (nowMs < cached.cooldownUntilMs || nowMs - cached.fetchedAtMs < maxAgeMs)) {
      return cached;
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const request = this.fetchEntry(fetcher, configDir, cached);
    this.inFlight.set(key, request);
    try {
      const entry = await request;
      this.entries.set(key, entry);
      return entry;
    } finally {
      if (this.inFlight.get(key) === request) {
        this.inFlight.delete(key);
      }
    }
  }

  private async fetchEntry(
    fetcher: ProviderUsageFetcher,
    configDir: string | undefined,
    previous: UsageEntry | undefined,
  ): Promise<UsageEntry> {
    const nowMs = this.now();
    try {
      const usage = await fetcher.fetchUsage(configDir ? { configDir } : undefined);
      return {
        fetchedAtMs: nowMs,
        usage,
        lastGood: usage.status === "error" ? (previous?.lastGood ?? null) : usage,
        cooldownUntilMs: 0,
        consecutiveRateLimits: 0,
      };
    } catch (error) {
      if (error instanceof ProviderRateLimitedError) {
        const consecutiveRateLimits = (previous?.consecutiveRateLimits ?? 0) + 1;
        const backoffMs = Math.min(
          RATE_LIMIT_BASE_COOLDOWN_MS * 2 ** (consecutiveRateLimits - 1),
          RATE_LIMIT_MAX_COOLDOWN_MS,
        );
        const cooldownMs = Math.max(error.retryAfterMs ?? 0, backoffMs);
        this.logger.warn(
          { providerId: fetcher.providerId, cooldownMs, consecutiveRateLimits },
          "Provider usage API rate limited; holding off",
        );
        const lastGood = previous?.lastGood ?? null;
        return {
          // Keep the last good figures' age so the client sees how stale they are.
          fetchedAtMs: lastGood ? (previous?.fetchedAtMs ?? nowMs) : nowMs,
          usage: lastGood ?? this.errorUsage(fetcher, error),
          lastGood,
          cooldownUntilMs: nowMs + cooldownMs,
          consecutiveRateLimits,
        };
      }
      this.logger.debug(
        { err: error, providerId: fetcher.providerId },
        "Provider usage fetch failed",
      );
      return {
        fetchedAtMs: nowMs,
        usage: this.errorUsage(fetcher, error),
        lastGood: previous?.lastGood ?? null,
        cooldownUntilMs: 0,
        consecutiveRateLimits: 0,
      };
    }
  }

  private errorUsage(fetcher: ProviderUsageFetcher, error: unknown): ProviderUsage {
    return unavailableUsage({
      providerId: fetcher.providerId,
      displayName: fetcher.displayName,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
