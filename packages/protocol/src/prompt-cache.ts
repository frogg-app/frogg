/**
 * How long a provider keeps a conversation in its prompt cache. Shared by the
 * client (the composer's stale-context warning) and the daemon (automatic
 * clean cuts) so both agree on when a conversation has gone cold.
 *
 * Only per-token-billed providers with a documented cache lifetime are listed;
 * guessing one would be inventing a number to act on. Left out on purpose:
 * - `copilot`: subscription-billed, so a cold cache costs nothing visible.
 * - `opencode`, `pi`, `omp`: the cache belongs to whichever upstream model is
 *   selected, which this rule cannot see.
 * - `mock` and custom provider ids: no known cache.
 *
 * Each value is the point past which the cache is best assumed gone, never
 * earlier than it could plausibly still be warm:
 * - `claude`: Claude Code writes its prompt cache with Anthropic's one-hour
 *   TTL (Anthropic prompt caching docs: `ttl: "1h"`, refreshed on each hit).
 * - `codex`: Codex CLI sends only `prompt_cache_key` (codex-rs/core/src/client.rs),
 *   never `prompt_cache_retention` or `prompt_cache_options`, so the model's
 *   default applies (OpenAI prompt caching guide). GPT-5.6 and later: a
 *   30-minute TTL, "may retain longer". GPT-5.5 and earlier: in-memory
 *   entries last 5-10 idle minutes and at most an hour; the 24h default for
 *   non-ZDR organisations "typically" keeps them around 30 minutes. An hour
 *   is past the typical life under every policy, so a cut there is almost
 *   never premature, while 24h would mean never cutting at all.
 */
export const PROMPT_CACHE_TTL_MS: Readonly<Record<string, number>> = {
  claude: 60 * 60 * 1000,
  codex: 60 * 60 * 1000,
};

/** The provider's prompt cache lifetime, or null when it is not known. */
export function getPromptCacheTtlMs(provider: string | null | undefined): number | null {
  if (!provider) return null;
  return Object.hasOwn(PROMPT_CACHE_TTL_MS, provider) ? PROMPT_CACHE_TTL_MS[provider] : null;
}

/**
 * COMPAT(cleanCutSettings): added in v1.6.5, remove after 2027-09-27.
 * The owner's idle thresholds, in minutes (the `cleanCut` daemon config).
 */
export interface IdleThresholdSettings {
  idleThresholdMinutes?: number;
  providers?: Readonly<Record<string, { idleThresholdMinutes?: number } | undefined>>;
}

/**
 * How long a conversation on this provider may sit idle before it counts as
 * cold, or null when it never does. The one rule behind both the automatic
 * clean cut and the composer's stale-context warning.
 *
 * A per-provider threshold wins, and is what makes a provider with no known
 * cache lifetime cuttable at all. The global threshold replaces the cache TTL
 * only for providers that have one: a subscription or unknown-cache provider
 * gains nothing from a cut, so a single global number should not start cutting
 * it.
 */
export function resolveIdleThresholdMs(
  provider: string | null | undefined,
  settings?: IdleThresholdSettings | null,
): number | null {
  if (!provider) return null;
  const override =
    settings?.providers && Object.hasOwn(settings.providers, provider)
      ? settings.providers[provider]?.idleThresholdMinutes
      : undefined;
  if (override !== undefined) return override * 60_000;
  const ttl = getPromptCacheTtlMs(provider);
  if (ttl === null) return null;
  return settings?.idleThresholdMinutes !== undefined
    ? settings.idleThresholdMinutes * 60_000
    : ttl;
}

/**
 * Whether a conversation has sat idle past its threshold (see
 * `resolveIdleThresholdMs`), which without settings is the provider's prompt
 * cache TTL: `true` cold, `false` warm, `null` unknown (no threshold or no
 * last-turn time). A last-turn time in the future (clock skew) counts as
 * warm, not as very stale.
 */
export function isPromptCacheCold(input: {
  provider: string | null | undefined;
  lastTurnAt: Date | number | null | undefined;
  now: number;
  settings?: IdleThresholdSettings | null;
}): boolean | null {
  const ttl = resolveIdleThresholdMs(input.provider, input.settings);
  if (ttl === null || input.lastTurnAt === null || input.lastTurnAt === undefined) return null;
  const at = typeof input.lastTurnAt === "number" ? input.lastTurnAt : input.lastTurnAt.getTime();
  const idleMs = input.now - at;
  if (!Number.isFinite(idleMs)) return null;
  return idleMs > ttl;
}
