/**
 * COMPAT(agentCleanCut): added in v1.6.2, remove after 2027-09-27.
 *
 * Automatic clean cut before the daemon resumes an agent on its own: after a
 * usage limit resets, and after a daemon restart cut a turn off. Resuming a
 * conversation whose prompt cache has expired re-sends the whole context at
 * full input price; a clean cut sends a short summary instead. While the cache
 * is warm, resuming is cheaper, so nothing happens.
 *
 * Each trigger has its own switch in the `cleanCut` daemon config, read live.
 * Coldness is judged by the shared rule in `@frogg/protocol/prompt-cache`, the
 * same one the composer's stale-context warning uses: idle longer than the
 * provider's threshold (the owner's setting, else the provider's cache TTL).
 * Providers with neither are never cut. Any failure (no conversation, the
 * summariser failing on every candidate) is logged and the caller resumes the
 * old conversation as it would have anyway.
 *
 * Every decision is logged with its outcome and reason, so a resume that went
 * ahead without a cut can be explained from the daemon log alone.
 */
import type { MutableCleanCutConfig } from "@frogg/protocol/messages";
import { isPromptCacheCold, resolveIdleThresholdMs } from "@frogg/protocol/prompt-cache";
import { runCleanCut, type CleanCutDeps } from "./clean-cut.js";

export type AutoCleanCutTrigger = "usage_limit" | "daemon_restart";

export interface AutoCleanCutDeps extends CleanCutDeps {
  getCleanCutSettings: () => MutableCleanCutConfig | undefined;
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

const MINUTE_MS = 60_000;

function isTriggerEnabled(
  settings: MutableCleanCutConfig | undefined,
  trigger: AutoCleanCutTrigger,
): boolean {
  const auto = settings?.auto;
  return trigger === "usage_limit" ? auto?.usageLimit !== false : auto?.daemonRestart !== false;
}

function toMinutes(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms / MINUTE_MS);
}

export async function maybeAutoCleanCut(
  deps: AutoCleanCutDeps,
  input: {
    agentId: string;
    /** When the agent last reached its provider, or null when not known. */
    lastProviderTurnAt: Date | null;
    /** Which resume path asked. */
    trigger: AutoCleanCutTrigger;
  },
): Promise<AutoCleanCutOutcome> {
  const { agentId, trigger } = input;
  const log = (
    outcome: AutoCleanCutOutcome,
    reason: string,
    details: Record<string, unknown> = {},
  ): AutoCleanCutOutcome => {
    const fields = { agentId, trigger, outcome, reason, ...details };
    if (outcome === "failed") {
      deps.logger.warn(fields, "Automatic clean cut failed; resuming the existing conversation");
    } else {
      deps.logger.info(fields, `Automatic clean cut: ${outcome}`);
    }
    return outcome;
  };

  const settings = deps.getCleanCutSettings();
  if (!isTriggerEnabled(settings, trigger)) {
    return log(
      "disabled",
      `cleanCut.auto.${trigger === "usage_limit" ? "usageLimit" : "daemonRestart"} is off`,
    );
  }
  const agent = deps.agentManager.getAgent(agentId);
  if (!agent) return log("skipped", "agent_not_loaded");
  if (agent.internal) return log("skipped", "internal_agent");
  if (agent.lifecycle === "closed" || agent.lifecycle === "running") {
    return log("skipped", `lifecycle_${agent.lifecycle}`);
  }
  if (!agent.persistence?.sessionId) return log("skipped", "no_provider_session");

  const now = (deps.now ?? Date.now)();
  const thresholdMs = resolveIdleThresholdMs(agent.provider, settings);
  const idleMs = input.lastProviderTurnAt ? now - input.lastProviderTurnAt.getTime() : null;
  const context = {
    provider: agent.provider,
    lastProviderTurnAt: input.lastProviderTurnAt?.toISOString() ?? null,
    idleMinutes: toMinutes(idleMs),
    thresholdMinutes: toMinutes(thresholdMs),
  };
  const cold = isPromptCacheCold({
    provider: agent.provider,
    lastTurnAt: input.lastProviderTurnAt,
    now,
    settings,
  });
  if (cold === null) {
    return log(
      "unknown",
      thresholdMs === null ? "no_threshold_for_provider" : "last_turn_time_unknown",
      context,
    );
  }
  if (!cold) return log("warm", "idle_within_threshold", context);
  try {
    const outcome = await (deps.cleanCut ?? runCleanCut)(deps, {
      agentId,
      target: {},
      reason: "cold-cache",
    });
    if (outcome === "unchanged") return log("unchanged", "nothing_new_since_last_cut", context);
    return log("cut", "idle_past_threshold", context);
  } catch (error) {
    return log("failed", error instanceof Error ? error.message : String(error), {
      ...context,
      err: error,
    });
  }
}
