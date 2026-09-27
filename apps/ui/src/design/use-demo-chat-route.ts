import { useEarliestOnlineHostServerId } from "@/app/_layout";
import { useSessionStore } from "@/stores/session-store";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

/**
 * The route to the most recently active chat on the first online host, so a reviewer can jump
 * straight to real conversation content from anywhere (the welcome screen included). Null while
 * no host is connected or it has no chats.
 */
export function useDemoChatRoute(): string | null {
  const serverId = useEarliestOnlineHostServerId();
  return useSessionStore((state) => {
    if (!serverId) return null;
    const agents = state.sessions[serverId]?.agents;
    if (!agents || agents.size === 0) return null;
    let latest: { id: string; workspaceId?: string; at: number } | null = null;
    for (const agent of agents.values()) {
      const at = agent.lastActivityAt.getTime();
      if (!latest || at > latest.at) latest = { id: agent.id, workspaceId: agent.workspaceId, at };
    }
    return latest ? buildHostAgentDetailRoute(serverId, latest.id, latest.workspaceId) : null;
  });
}
