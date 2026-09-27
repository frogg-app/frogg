/**
 * COMPAT(agentCleanCutSubagents): added in v1.6.2, remove after 2027-09-27.
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
 *
 * Children persisted on disk but not loaded in memory (the daemon loads agents
 * lazily) are found through storage, loaded for the cut, and unloaded again
 * afterwards so they end in the state they started in. Archived children are
 * left alone.
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

/** A child persisted on disk and not loaded in memory. */
export interface StoredCleanCutChild {
  id: string;
  title: string | null;
  createdAt: Date;
}

export interface CleanCutSubagentsDeps extends CleanCutDeps {
  /** Unloaded, unarchived, non-internal children of an agent on disk. */
  listStoredChildren?: (parentAgentId: string) => Promise<StoredCleanCutChild[]>;
  /** Loads a stored agent into memory. */
  loadAgent?: (agentId: string) => Promise<ManagedAgent>;
  /** Unloads an agent loaded only for its cut. */
  unloadAgent?: (agentId: string) => Promise<void>;
}

interface ChildRef {
  id: string;
  title: string | null;
  createdAt: Date;
  loaded: boolean;
}

async function listChildren(
  deps: CleanCutSubagentsDeps,
  parentAgentId: string,
): Promise<ChildRef[]> {
  const loaded: ChildRef[] = listCleanCutChildren(deps.agentManager, parentAgentId).map(
    (agent) => ({
      id: agent.id,
      title: agent.config.title ?? null,
      createdAt: agent.createdAt,
      loaded: true,
    }),
  );
  let stored: StoredCleanCutChild[] = [];
  if (deps.listStoredChildren) {
    try {
      stored = await deps.listStoredChildren(parentAgentId);
    } catch (error) {
      deps.logger.warn({ err: error, parentAgentId }, "Could not list stored subagents");
    }
  }
  const seen = new Set(loaded.map((child) => child.id));
  const unloaded = stored
    .filter((child) => !seen.has(child.id) && !deps.agentManager.getAgent(child.id))
    .map(
      (child): ChildRef => ({
        id: child.id,
        title: child.title,
        createdAt: child.createdAt,
        loaded: false,
      }),
    );
  return [...loaded, ...unloaded].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
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

/** Cuts one child, loading it first when only stored, and unloading it again. */
async function cutChild(
  deps: CleanCutSubagentsDeps,
  ref: ChildRef,
  base: Omit<CleanCutSubagentResult, "status" | "reason">,
): Promise<CleanCutSubagentResult> {
  let loadedHere = false;
  try {
    let child = deps.agentManager.getAgent(ref.id);
    if (!child) {
      if (ref.loaded || !deps.loadAgent) {
        return { ...base, status: "skipped", reason: "not loaded" };
      }
      child = await deps.loadAgent(ref.id);
      loadedHere = true;
    }
    const reason = skipReason(deps, child);
    if (reason) {
      return { ...base, status: "skipped", reason };
    }
    const outcome = await runCleanCut(deps, { agentId: ref.id, target: {} });
    return outcome === "cut"
      ? { ...base, status: "cut" }
      : { ...base, status: "skipped", reason: "nothing to summarise" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn(
      { err: error, agentId: ref.id, parentAgentId: base.parentAgentId },
      "Clean cut of a subagent failed",
    );
    return { ...base, status: "failed", reason: message };
  } finally {
    if (loadedHere && deps.unloadAgent) {
      await deps.unloadAgent(ref.id).catch((error: unknown) => {
        deps.logger.warn(
          { err: error, agentId: ref.id },
          "Could not unload subagent after its clean cut",
        );
      });
    }
  }
}

/**
 * Cuts every descendant of `rootAgentId`, parents before their children, one
 * at a time so summarisers do not pile up on the same account. Never throws.
 */
export async function runCleanCutForSubagents(
  deps: CleanCutSubagentsDeps,
  rootAgentId: string,
): Promise<CleanCutSubagentResult[]> {
  const results: CleanCutSubagentResult[] = [];
  const visited = new Set<string>([rootAgentId]);
  const queue: string[] = [rootAgentId];
  while (queue.length > 0) {
    const parentAgentId = queue.shift()!;
    for (const ref of await listChildren(deps, parentAgentId)) {
      if (visited.has(ref.id)) continue;
      visited.add(ref.id);
      // A running child's own children may be idle; still visit them.
      queue.push(ref.id);
      results.push(await cutChild(deps, ref, { agentId: ref.id, parentAgentId, title: ref.title }));
    }
  }
  return results;
}
