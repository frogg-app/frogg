/**
 * COMPAT(staleContextWarning): added in v1.5.7.
 *
 * A provider's prompt cache holds a conversation for a limited time (an hour
 * for Claude Code). Come back after
 * that and the next message is not a cheap continuation: the whole context is
 * re-sent as fresh input, billed in full, before the model reads a word of what
 * was just typed. Nothing in the UI used to say so, and the cost only showed up
 * afterwards.
 *
 * This decides when the composer says it. The rule is deliberately narrow — it
 * fires on a real conversation the user is about to add to, not on every idle
 * tab — so the warning keeps meaning something when it does appear.
 */

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long each provider's prompt cache is assumed to outlive an idle
 * conversation. Pure data with no app imports, so it can be lifted into shared
 * code unchanged.
 *
 * Only providers with per-token billing and a documented cache lifetime belong
 * here. Cache lifetimes are a provider's own business; guessing one would be
 * inventing a number to warn about. Left out on purpose:
 * - `copilot`: subscription-billed, so a cold cache costs nothing visible.
 * - `opencode`, `pi`, `omp`: multi-model harnesses; the cache belongs to
 *   whichever upstream model is selected, which this rule cannot see.
 * - `mock` and any custom provider id: no known cache.
 *
 * - `claude`: Claude Code writes its prompt cache with the one-hour TTL.
 * - `codex`: OpenAI's in-memory prompt cache is evicted after 5-10 minutes of
 *   inactivity and never lasts past one hour. The hour is the upper bound, so
 *   the warning never fires while the cache could still be warm.
 */
export const STALE_CONTEXT_TTL_MS_BY_PROVIDER: Readonly<Record<string, number>> = {
  claude: HOUR_MS,
  codex: HOUR_MS,
};

/** The cache window for a provider, or null when the rule does not apply to it. */
export function staleContextTtlMs(provider: string | null): number | null {
  if (provider === null) return null;
  return Object.hasOwn(STALE_CONTEXT_TTL_MS_BY_PROVIDER, provider)
    ? STALE_CONTEXT_TTL_MS_BY_PROVIDER[provider]
    : null;
}

/**
 * Claude's cache window.
 * @deprecated Use `staleContextTtlMs(provider)`; windows are per provider.
 */
export const STALE_CONTEXT_IDLE_MS = HOUR_MS;

export interface StaleContextInput {
  /** The agent's provider, or null when the composer has no agent yet. */
  provider: string | null;
  /** The agent's current context size, or null before any usage is reported. */
  contextTokens: number | null;
  /**
   * True when this agent has a conversation behind it. Usage figures only exist
   * once a turn has reported them to this daemon, so a resumed agent — or one
   * whose daemon has restarted since it last ran — has a full context to re-send
   * and no number for it. That is still worth warning about.
   */
  hasConversation: boolean;
  /** When this conversation last saw activity. */
  lastActivityAt: Date | null;
  /** True once the user has actually started typing something to send. */
  isComposing: boolean;
  now: number;
}

export interface StaleContextWarning {
  /**
   * The context that will be re-sent, or null when the size is not known — the
   * warning then says what happens without putting a figure on it.
   */
  tokens: number | null;
}

/**
 * The warning to show, or null for silence.
 *
 * Every condition has to hold: its provider has a known cache window, it has a context
 * worth re-sending, it has been idle past the cache window, and the user is
 * mid-sentence rather than merely looking at the screen. A brand-new agent with
 * nothing behind it is the ordinary first-message case, which costs what it
 * costs and has nothing to warn about; an agent whose usage figures are simply
 * unreported still warns, without a number.
 */
export function resolveStaleContextWarning(input: StaleContextInput): StaleContextWarning | null {
  const ttlMs = staleContextTtlMs(input.provider);
  if (ttlMs === null) return null;
  if (!input.isComposing) return null;
  if (input.contextTokens !== null && input.contextTokens <= 0) return null;
  if (input.contextTokens === null && !input.hasConversation) return null;
  if (!input.lastActivityAt) return null;

  const idleMs = input.now - input.lastActivityAt.getTime();
  // A last-activity stamp in the future (clock skew between daemon and client)
  // is not an idle conversation; treat it as fresh rather than as very stale.
  if (!Number.isFinite(idleMs) || idleMs <= ttlMs) return null;

  return { tokens: input.contextTokens };
}
