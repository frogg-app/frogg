import type { Logger } from "pino";
import type { ProviderUsage } from "../../server/messages.js";

export type ProviderApiFetch = typeof fetch;

/**
 * Which sign-in a single usage fetch describes.
 *
 * COMPAT(providerUsageAccountScoped): added in v1.5.5. A fetcher whose
 * credentials do not live in a redirectable config directory (Copilot reads the
 * GitHub CLI's host config, Cursor a SQLite state db, the API-key providers an
 * environment variable) has nothing to scope and ignores this.
 */
export interface ProviderUsageFetchContext {
  /**
   * Read credentials from this directory instead of the fetcher's default one.
   * Always an absolute path to the provider's config directory itself, never to
   * a synthetic home.
   */
  configDir?: string;
}

export interface ProviderUsageFetcher {
  readonly providerId: string;
  readonly displayName: string;
  fetchUsage(context?: ProviderUsageFetchContext): Promise<ProviderUsage>;
}

export interface ProviderUsageFetcherFactoryOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
}

export interface ProviderUsageFetcherManifestEntry {
  readonly providerId: string;
  create(options: ProviderUsageFetcherFactoryOptions): ProviderUsageFetcher;
}
