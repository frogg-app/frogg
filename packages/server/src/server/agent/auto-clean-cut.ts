/**
 * COMPAT(agentCleanCut): added in v1.6.2, remove after 2027-09-27.
 *
 * Automatic clean cut before the daemon resumes an agent on its own: after a
 * usage limit resets, and after a daemon restart cut a turn off. Resuming a
 * conversation whose prompt cache has expired re-sends the whole context at
 * full input price; a clean cut sends a short summary instead. While the cache
 * is warm, resuming is cheaper, so nothing happens.
 *
 * Warmth is judged by the shared rule in `@frogg/protocol/prompt-cache`, the
 * same one the composer's stale-context warning uses. Providers without a
 * known cache lifetime are never cut. Any failure (no conversation, the
 * summariser failing on every candidate) is logged and the caller resumes the
 * old conversation as it would have anyway.
 */
import { isPromptCacheCold } from "@frogg/protocol/prompt-cache";
import { runCleanCut, type CleanCutDeps } from "./clean-cut.js";

export interface AutoCleanCutDeps extends CleanCutDeps {
  isEnabled: () => boolean;
  now?: () => number;
  /** Test seam for the cut itself. */
  cleanCut?: typeof runCleanCut;
}

/** `unchanged`: the cache was cold but nothing was new since the previous cut, so none was made. */
export type AutoCleanCutOutcome =
  | "cut"
  | "unchanged"
  | "warm"
  | "unknown"
  | "disabled"
  | "skipped"
  | "failed";

export async function maybeAutoCleanCut(
  deps: AutoCleanCutDeps,
  input: {
    agentId: string;
    /** When the agent last reached its provider, or null when not known. */
    lastProviderTurnAt: Date | null;
    /** Log context: which resume path asked. */
    trigger: "usage_limit" | "daemon_restart";
  },
): Promise<AutoCleanCutOutcome> {
  const { agentId, trigger } = input;
  if (!deps.isEnabled()) return "disabled";
  const agent = deps.agentManager.getAgent(agentId);
  if (!agent || agent.internal || agent.lifecycle === "closed" || agent.lifecycle === "running") {
    return "skipped";
  }
  if (!agent.persistence?.sessionId) return "skipped";
  const cold = isPromptCacheCold({
    provider: agent.provider,
    lastTurnAt: input.lastProviderTurnAt,
    now: (deps.now ?? Date.now)(),
  });
  if (cold === null) return "unknown";
  if (!cold) return "warm";
  try {
    const outcome = await (deps.cleanCut ?? runCleanCut)(deps, {
      agentId,
      target: {},
      reason: "cold-cache",
    });
    if (outcome === "unchanged") {
      deps.logger.info(
        { agentId, trigger },
        "Cold cache, but nothing new since the previous clean cut; resuming as is",
      );
      return "unchanged";
    }
    deps.logger.info({ agentId, trigger }, "Automatic clean cut before resume (cold cache)");
    return "cut";
  } catch (error) {
    deps.logger.warn(
      { err: error, agentId, trigger },
      "Automatic clean cut failed; resuming the existing conversation",
    );
    return "failed";
  }
}
