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

import {
  getPromptCacheTtlMs,
  isPromptCacheCold,
  PROMPT_CACHE_TTL_MS,
  resolveIdleThresholdMs,
  type IdleThresholdSettings,
} from "@frogg/protocol/prompt-cache";

/**
 * How long each provider's prompt cache is assumed to outlive an idle
 * conversation. Lives in `@frogg/protocol/prompt-cache`, shared with the
 * daemon's automatic clean cut.
 */
export const STALE_CONTEXT_TTL_MS_BY_PROVIDER: Readonly<Record<string, number>> =
  PROMPT_CACHE_TTL_MS;

/**
 * The idle window for a provider, or null when the rule does not apply to it:
 * the host's clean cut threshold when one is set, else the provider's cache
 * TTL. The same rule decides the daemon's automatic clean cut.
 */
export function staleContextTtlMs(
  provider: string | null,
  settings?: IdleThresholdSettings | null,
): number | null {
  return resolveIdleThresholdMs(provider, settings);
}

/**
 * Claude's cache window.
 * @deprecated Use `staleContextTtlMs(provider)`; windows are per provider.
 */
export const STALE_CONTEXT_IDLE_MS = getPromptCacheTtlMs("claude") ?? 60 * 60 * 1000;

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
  /** The host's clean cut thresholds (`cleanCut` daemon config), when known. */
  thresholds?: IdleThresholdSettings | null;
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
  if (staleContextTtlMs(input.provider, input.thresholds) === null) return null;
  if (!input.isComposing) return null;
  if (input.contextTokens !== null && input.contextTokens <= 0) return null;
  if (input.contextTokens === null && !input.hasConversation) return null;
  if (!input.lastActivityAt) return null;

  // A last-activity stamp in the future (clock skew between daemon and client)
  // is not an idle conversation; the shared rule treats it as warm.
  const cold = isPromptCacheCold({
    provider: input.provider,
    lastTurnAt: input.lastActivityAt,
    now: input.now,
    settings: input.thresholds,
  });
  if (cold !== true) return null;

  return { tokens: input.contextTokens };
}
