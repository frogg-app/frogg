import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

export interface InsetAgentSummary {
  id: string;
  title: string | null;
  provider: string;
  model: string | null;
  bucket: SidebarStateBucket;
}

function summarize(agent: Agent): InsetAgentSummary {
  return {
    id: agent.id,
    title: agent.title,
    provider: agent.provider,
    model: agent.runtimeInfo?.model ?? agent.model,
    bucket: deriveSidebarStateBucket({
      status: agent.activeTurn ? "running" : agent.status,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason ?? undefined,
    }),
  };
}

function sameSummaries(left: InsetAgentSummary[], right: InsetAgentSummary[]): boolean {
  return (
    left.length === right.length &&
    left.every((agent, index) => {
      const other = right[index]!;
      return (
        agent.id === other.id &&
        agent.title === other.title &&
        agent.model === other.model &&
        agent.bucket === other.bucket
      );
    })
  );
}

/**
 * The workspace's top-level, unarchived agents, most recently active first — so the first one
 * is the agent the workspace is "about".
 */
export function useWorkspaceAgents(serverId: string, workspaceId: string): InsetAgentSummary[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const agents = state.sessions[serverId]?.agents;
      if (!agents) return [];
      return [...agents.values()]
        .filter(
          (agent) => agent.workspaceId === workspaceId && !agent.archivedAt && !agent.parentAgentId,
        )
        .sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())
        .map(summarize);
    },
    sameSummaries,
  );
}
