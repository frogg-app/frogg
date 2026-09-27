import { router, usePathname } from "expo-router";
import { useCallback } from "react";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import {
  buildNewChatRoute,
  buildNewWorkspaceRoute,
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import { useMonoScope } from "./mono-scope";

export type MonoTab = "overview" | "chats" | "changes" | "settings";

export interface MonoRoute {
  tab: MonoTab | null;
  serverId: string | null;
  workspace: WorkspaceDescriptor | null;
}

function tabOf(pathname: string, inWorkspace: boolean): MonoTab | null {
  if (pathname === "/" || pathname.startsWith("/open-project")) return "overview";
  if (pathname.startsWith("/sessions") || inWorkspace) return "chats";
  if (pathname.startsWith("/settings")) return "settings";
  return null;
}

/** Where the user is, in the header's terms: which tab, host and workspace are current. */
export function useMonoRoute(): MonoRoute {
  const pathname = usePathname();
  const workspaceRoute = parseHostWorkspaceRouteFromPathname(pathname);
  const agentRoute = parseHostAgentRouteFromPathname(pathname);
  const serverId = workspaceRoute?.serverId ?? agentRoute?.serverId ?? null;
  const workspace = useSessionStore((state) => {
    if (!serverId) return null;
    const session = state.sessions[serverId];
    const workspaceId =
      workspaceRoute?.workspaceId ??
      (agentRoute ? session?.agents.get(agentRoute.agentId)?.workspaceId : undefined);
    return (workspaceId ? session?.workspaces.get(workspaceId) : undefined) ?? null;
  });
  return { tab: tabOf(pathname, workspace !== null), serverId, workspace };
}

export function openFind(): void {
  useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
}

function useChatsServerId(preferred: string | null): string | null {
  return useSessionStore((state) => {
    const canRunChats = (id: string) => state.sessions[id]?.serverInfo?.features?.chats === true;
    if (preferred && canRunChats(preferred)) return preferred;
    return Object.keys(state.sessions).find(canRunChats) ?? preferred;
  });
}

/**
 * The header's primary action. Inside a workspace it opens a new agent tab there (the shipping
 * "new agent" action); elsewhere it starts a chat on the scoped host, or a new session where the
 * host has no chats.
 */
export function useMonoNewChat(route: MonoRoute): () => void {
  const dispatcher = useKeyboardActionDispatcher();
  const scopeServerId = useMonoScope((state) => state.serverId);
  const chatsServerId = useChatsServerId(route.serverId ?? scopeServerId);
  const hasChats = useSessionStore((state) =>
    chatsServerId ? state.sessions[chatsServerId]?.serverInfo?.features?.chats === true : false,
  );
  const inWorkspace = route.workspace !== null;
  return useCallback(() => {
    if (inWorkspace && dispatcher.dispatch({ id: "workspace.agent.new", scope: "workspace" })) {
      return;
    }
    if (chatsServerId && hasChats) {
      router.push(buildNewChatRoute(chatsServerId));
      return;
    }
    router.push(buildNewWorkspaceRoute(chatsServerId ? { serverId: chatsServerId } : {}));
  }, [chatsServerId, dispatcher, hasChats, inWorkspace]);
}
