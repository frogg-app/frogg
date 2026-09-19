/**
 * COMPAT(staleContextWarning): added in v1.5.7.
 *
 * Claude Code's prompt cache holds a conversation for an hour. Come back after
 * that and the next message is not a cheap continuation: the whole context is
 * re-sent as fresh input, billed in full, before the model reads a word of what
 * was just typed. Nothing in the UI used to say so, and the cost only showed up
 * afterwards.
 *
 * This decides when the composer says it. The rule is deliberately narrow — it
 * fires on a real conversation the user is about to add to, not on every idle
 * tab — so the warning keeps meaning something when it does appear.
 */

/** How long a conversation can sit before its prompt cache is assumed gone. */
export const STALE_CONTEXT_IDLE_MS = 60 * 60 * 1000;

/**
 * The provider this applies to. Cache lifetimes are a provider's own business,
 * and an hour is Claude's; pretending to know another provider's would be
 * inventing a number to warn about.
 */
export const STALE_CONTEXT_PROVIDER = "claude";

export interface StaleContextInput {
  /** The agent's provider, or null when the composer has no agent yet. */
  provider: string | null;
  /** The agent's current context size, or null before any usage is reported. */
  contextTokens: number | null;
  /** When this conversation last saw activity. */
  lastActivityAt: Date | null;
  /** True once the user has actually started typing something to send. */
  isComposing: boolean;
  now: number;
}

export interface StaleContextWarning {
  /** The context that will be re-sent, for the figure in the warning. */
  tokens: number;
}

/**
 * The warning to show, or null for silence.
 *
 * Every condition has to hold: it is a Claude conversation, it has a context
 * worth re-sending, it has been idle past the cache window, and the user is
 * mid-sentence rather than merely looking at the screen. An agent with no
 * context yet is the ordinary first-message case, which costs what it costs and
 * has nothing to warn about.
 */
export function resolveStaleContextWarning(input: StaleContextInput): StaleContextWarning | null {
  if (input.provider !== STALE_CONTEXT_PROVIDER) return null;
  if (!input.isComposing) return null;
  if (input.contextTokens === null || input.contextTokens <= 0) return null;
  if (!input.lastActivityAt) return null;

  const idleMs = input.now - input.lastActivityAt.getTime();
  // A last-activity stamp in the future (clock skew between daemon and client)
  // is not an idle conversation; treat it as fresh rather than as very stale.
  if (!Number.isFinite(idleMs) || idleMs <= STALE_CONTEXT_IDLE_MS) return null;

  return { tokens: input.contextTokens };
}
