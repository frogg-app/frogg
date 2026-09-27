/**
 * How long a provider keeps a conversation in its prompt cache. Shared by the
 * client (the composer's stale-context warning) and the daemon (automatic
 * clean cuts) so both agree on when a conversation has gone cold.
 *
 * Only providers whose cache lifetime is known are listed. Claude Code's
 * prompt cache holds a conversation for an hour; pretending to know another
 * provider's lifetime would be inventing a number to act on.
 */
export const PROMPT_CACHE_TTL_MS: Readonly<Record<string, number>> = {
  claude: 60 * 60 * 1000,
};

/** The provider's prompt cache lifetime, or null when it is not known. */
export function getPromptCacheTtlMs(provider: string | null | undefined): number | null {
  if (!provider) return null;
  return Object.hasOwn(PROMPT_CACHE_TTL_MS, provider) ? PROMPT_CACHE_TTL_MS[provider] : null;
}

/**
 * Whether the provider's prompt cache for a conversation has expired: `true`
 * cold, `false` warm, `null` unknown (no known TTL or no last-turn time). A
 * last-turn time in the future (clock skew) counts as warm, not as very stale.
 */
export function isPromptCacheCold(input: {
  provider: string | null | undefined;
  lastTurnAt: Date | number | null | undefined;
  now: number;
}): boolean | null {
  const ttl = getPromptCacheTtlMs(input.provider);
  if (ttl === null || input.lastTurnAt === null || input.lastTurnAt === undefined) return null;
  const at = typeof input.lastTurnAt === "number" ? input.lastTurnAt : input.lastTurnAt.getTime();
  const idleMs = input.now - at;
  if (!Number.isFinite(idleMs)) return null;
  return idleMs > ttl;
}
