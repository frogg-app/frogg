/**
 * COMPAT(agentCleanCutSubagents): added in v1.7.0, remove after 2027-09-27.
 *
 * A clean cut of an orchestrator also cuts the Frogg child agents it spawned
 * (agents labelled with its id, and their children in turn), each summarised
 * from its own timeline and kept on its own provider and model. Worktrees stay
 * on disk, so only the conversations reset.
 *
 * Provider-native subagents (a provider's own task tool, tracked by the
 * provider subagent store) have no provider session of their own: they live
 * inside the parent's conversation and end with it, so there is nothing more
 * to cut.
 *
 * The parent's cut has already succeeded by the time this runs. A child that is
 * mid-turn is skipped, as the parent would have been; a child with nothing new
 * to summarise is skipped; a child whose cut throws is reported as failed. None
 * of these fail the parent's cut.
 */
import { PARENT_AGENT_ID_LABEL } from "@frogg/protocol/agent-labels";
import type { ManagedAgent } from "./agent-manager.js";
import { runCleanCut, selectCleanCutItems, type CleanCutDeps } from "./clean-cut.js";

export type CleanCutSubagentStatus = "cut" | "skipped" | "failed";

export interface CleanCutSubagentResult {
  agentId: string;
  parentAgentId: string;
  title: string | null;
  status: CleanCutSubagentStatus;
  /** Why a child was skipped or failed; absent when it was cut. */
  reason?: string;
}

/** The loaded, visible Frogg children of an agent, oldest first. */
export function listCleanCutChildren(
  agentManager: Pick<CleanCutDeps["agentManager"], "listAgents">,
  parentAgentId: string,
): ManagedAgent[] {
  return agentManager
    .listAgents()
    .filter((agent) => agent.labels?.[PARENT_AGENT_ID_LABEL] === parentAgentId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function skipReason(deps: CleanCutDeps, agent: ManagedAgent): string | null {
  if (agent.lifecycle === "running") {
    return "running";
  }
  if (agent.lifecycle === "closed") {
    return "closed";
  }
  const selected = selectCleanCutItems(deps.agentManager.getTimeline(agent.id));
  if (!selected.some((item) => item.type === "user_message")) {
    return "nothing to summarise";
  }
  return null;
}

/**
 * Cuts every descendant of `rootAgentId`, parents before their children, one
 * at a time so summarisers do not pile up on the same account. Never throws.
 */
export async function runCleanCutForSubagents(
  deps: CleanCutDeps,
  rootAgentId: string,
): Promise<CleanCutSubagentResult[]> {
  const results: CleanCutSubagentResult[] = [];
  const visited = new Set<string>([rootAgentId]);
  const queue: string[] = [rootAgentId];
  while (queue.length > 0) {
    const parentAgentId = queue.shift()!;
    for (const child of listCleanCutChildren(deps.agentManager, parentAgentId)) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      // A running child's own children may be idle; still visit them.
      queue.push(child.id);
      const base = { agentId: child.id, parentAgentId, title: child.config.title ?? null };
      const reason = skipReason(deps, child);
      if (reason) {
        results.push({ ...base, status: "skipped", reason });
        continue;
      }
      try {
        await runCleanCut(deps, { agentId: child.id, target: {} });
        results.push({ ...base, status: "cut" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.logger.warn(
          { err: error, agentId: child.id, parentAgentId },
          "Clean cut of a subagent failed",
        );
        results.push({ ...base, status: "failed", reason: message });
      }
    }
  }
  return results;
}
