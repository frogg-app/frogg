import type { Logger } from "pino";
import type { ProviderUsage } from "../../server/messages.js";
import { createProviderUsageFetchers } from "./manifest.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "./provider.js";
import { unavailableUsage } from "./usage.js";

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
/** No caller can make the daemon ask a provider more often than this. */
export const MIN_PROVIDER_USAGE_MAX_AGE_MS = 5 * 1000;

export class ProviderUsageService {
  private readonly logger: Logger;
  private readonly fetchers: ProviderUsageFetcher[];
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  /**
   * Cache and in-flight de-duplication are keyed by the config-directory
   * selection, not global: the same provider read against two sign-ins gives
   * two different answers, and serving one for the other is exactly the bug
   * this keying exists to prevent.
   */
  private readonly cached = new Map<
    string,
    { fetchedAtMs: number; result: ProviderUsageListResult }
  >();
  private readonly inFlight = new Map<string, Promise<ProviderUsageListResult>>();

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
    forceRefresh?: boolean;
    /** The oldest cached result the caller accepts; floored at MIN_PROVIDER_USAGE_MAX_AGE_MS. */
    maxAgeMs?: number;
    configDirs?: Readonly<Record<string, string>>;
  }): Promise<ProviderUsageListResult> {
    const nowMs = this.now();
    const configDirs = options?.configDirs ?? {};
    const cacheKey = buildCacheKey(configDirs);
    const ttlMs =
      options?.maxAgeMs === undefined
        ? this.cacheTtlMs
        : Math.min(this.cacheTtlMs, Math.max(options.maxAgeMs, MIN_PROVIDER_USAGE_MAX_AGE_MS));

    const cached = this.cached.get(cacheKey);
    if (!options?.forceRefresh && cached && nowMs - cached.fetchedAtMs < ttlMs) {
      return cached.result;
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) {
      return pending;
    }

    const request = this.fetchFreshUsage(nowMs, cacheKey, configDirs);
    this.inFlight.set(cacheKey, request);
    try {
      return await request;
    } finally {
      if (this.inFlight.get(cacheKey) === request) {
        this.inFlight.delete(cacheKey);
      }
    }
  }

  private async fetchFreshUsage(
    nowMs: number,
    cacheKey: string,
    configDirs: Readonly<Record<string, string>>,
  ): Promise<ProviderUsageListResult> {
    const settled = await Promise.allSettled(
      this.fetchers.map((fetcher) => {
        const configDir = configDirs[fetcher.providerId];
        return fetcher.fetchUsage(configDir ? { configDir } : undefined);
      }),
    );
    const providers = settled.map((result, index) => {
      const fetcher = this.fetchers[index];
      if (result.status === "fulfilled") {
        return result.value;
      }
      this.logger.debug(
        { err: result.reason, providerId: fetcher.providerId },
        "Provider usage fetch failed",
      );
      return unavailableUsage({
        providerId: fetcher.providerId,
        displayName: fetcher.displayName,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
    });

    const result = { fetchedAt: new Date(nowMs).toISOString(), providers };
    this.cached.set(cacheKey, { fetchedAtMs: nowMs, result });
    return result;
  }
}

/**
 * A stable key for a config-directory selection. Sorted so two callers naming
 * the same directories in a different order share one cache entry and one
 * in-flight request.
 */
function buildCacheKey(configDirs: Readonly<Record<string, string>>): string {
  const entries = Object.entries(configDirs).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0
    ? ""
    : entries.map(([provider, dir]) => `${provider}=${dir}`).join("\u0000");
}
