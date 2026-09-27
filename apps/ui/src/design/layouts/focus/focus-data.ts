import { useMemo } from "react";
import { create } from "zustand";
import { useEarliestOnlineHostServerId } from "@/app/_layout";
import { useHosts } from "@/runtime/host-runtime";
import {
  useSessionStore,
  type Agent,
  type ProjectDescriptor,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import { selectRecentAgents } from "./focus-model";

// Which host the Focus sidebar's switcher is pointed at. Session-only on purpose: it is a
// preview surface, and the next launch should start on the first host that is online.
interface FocusHostState {
  serverId: string | null;
  setServerId: (serverId: string) => void;
}

export const useFocusHostStore = create<FocusHostState>()((set) => ({
  serverId: null,
  setServerId: (serverId) => set({ serverId }),
}));

/** The switcher's host when it is still configured, else the first online host. */
export function useFocusServerId(): string | null {
  const chosen = useFocusHostStore((state) => state.serverId);
  const hosts = useHosts();
  const earliestOnline = useEarliestOnlineHostServerId();
  if (chosen && hosts.some((host) => host.serverId === chosen)) return chosen;
  return earliestOnline ?? hosts[0]?.serverId ?? null;
}

const EMPTY_AGENTS: ReadonlyMap<string, Agent> = new Map();
const EMPTY_WORKSPACES: ReadonlyMap<string, WorkspaceDescriptor> = new Map();
const EMPTY_PROJECTS: ReadonlyMap<string, ProjectDescriptor> = new Map();

export function useFocusAgents(serverId: string | null): ReadonlyMap<string, Agent> {
  return useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.agents ?? EMPTY_AGENTS) : EMPTY_AGENTS,
  );
}

export function useFocusWorkspaces(
  serverId: string | null,
): ReadonlyMap<string, WorkspaceDescriptor> {
  return useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.workspaces ?? EMPTY_WORKSPACES) : EMPTY_WORKSPACES,
  );
}

export function useFocusProjects(serverId: string | null): ReadonlyMap<string, ProjectDescriptor> {
  return useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.projects ?? EMPTY_PROJECTS) : EMPTY_PROJECTS,
  );
}

export function useFocusHasHydratedAgents(serverId: string | null): boolean {
  return useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.hasHydratedAgents ?? false) : false,
  );
}

const RECENT_LIMIT = 40;

export function useFocusRecentAgents(serverId: string | null): Agent[] {
  const agents = useFocusAgents(serverId);
  return useMemo(() => selectRecentAgents(agents.values(), RECENT_LIMIT), [agents]);
}
