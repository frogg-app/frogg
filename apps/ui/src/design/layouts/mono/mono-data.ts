import { useEffect, useMemo, useState } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useHosts } from "@/runtime/host-runtime";
import { useSessionStore, type Agent, type WorkspaceDescriptor } from "@/stores/session-store";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

// Mono's dashboard reads chats the way Vercel reads deployments: one row per agent, joined to its
// workspace (project, branch, diff) and host. Everything here comes from the session store.

interface SessionSource {
  serverId: string;
  agents: Map<string, Agent>;
  workspaces: Map<string, WorkspaceDescriptor>;
}

function selectSources(state: {
  sessions: Record<string, { agents: Map<string, Agent>; workspaces: Map<string, WorkspaceDescriptor> }>;
}): SessionSource[] {
  return Object.entries(state.sessions).map(([serverId, session]) => ({
    serverId,
    agents: session.agents,
    workspaces: session.workspaces,
  }));
}

// Streaming text lives in the same session objects, so compare only the two maps we read.
function sameSources(a: SessionSource[], b: SessionSource[]): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (source, index) =>
      source.serverId === b[index]?.serverId &&
      source.agents === b[index]?.agents &&
      source.workspaces === b[index]?.workspaces,
  );
}

export function useSessionSources(): SessionSource[] {
  return useStoreWithEqualityFn(useSessionStore, selectSources, sameSources);
}

export interface MonoChatRow {
  key: string;
  serverId: string;
  agentId: string;
  workspaceId: string | null;
  shortId: string;
  title: string;
  provider: string;
  model: string | null;
  bucket: SidebarStateBucket;
  /** When the current turn started (running) or the last user message (otherwise). */
  turnStartedAt: Date | null;
  lastActivityAt: Date;
  updatedAt: Date;
  createdAt: Date;
  projectName: string | null;
  branch: string | null;
  workspaceName: string | null;
  cwd: string;
  diffStat: { additions: number; deletions: number } | null;
  hostLabel: string;
}

export function projectNameOf(workspace: WorkspaceDescriptor): string {
  return workspace.projectCustomName ?? workspace.projectDisplayName ?? workspace.projectId;
}

export function branchOf(workspace: WorkspaceDescriptor | undefined): string | null {
  const branch = workspace?.gitRuntime?.currentBranch?.trim();
  return branch ? branch : null;
}

export function bucketOf(agent: Agent): SidebarStateBucket {
  return deriveSidebarStateBucket({
    status: agent.status,
    requiresAttention: Boolean(agent.requiresAttention),
    attentionReason: agent.attentionReason ?? null,
    pendingPermissionCount: agent.pendingPermissions.length,
  });
}

export function shortIdOf(agentId: string): string {
  return agentId.replace(/-/g, "").slice(0, 9);
}

export function toChatRow(input: {
  serverId: string;
  agent: Agent;
  workspace: WorkspaceDescriptor | undefined;
  hostLabel: string;
}): MonoChatRow {
  const { serverId, agent, workspace, hostLabel } = input;
  const bucket = bucketOf(agent);
  return {
    key: `${serverId}:${agent.id}`,
    serverId,
    agentId: agent.id,
    workspaceId: agent.workspaceId ?? null,
    shortId: shortIdOf(agent.id),
    title: agent.title?.trim() || workspace?.name || shortIdOf(agent.id),
    provider: agent.provider,
    model: agent.model,
    bucket,
    turnStartedAt:
      bucket === "running"
        ? (agent.activeTurn?.startedAt ?? agent.lastUserMessageAt)
        : agent.lastUserMessageAt,
    lastActivityAt: agent.lastActivityAt,
    updatedAt: agent.updatedAt,
    createdAt: agent.createdAt,
    projectName: workspace && !workspace.chat ? projectNameOf(workspace) : null,
    branch: branchOf(workspace),
    workspaceName: workspace?.name ?? null,
    cwd: agent.cwd,
    diffStat: workspace?.diffStat ?? null,
    hostLabel,
  };
}

/** Every top-level, unarchived chat on every host, newest activity first. */
export function useMonoChatRows(): MonoChatRow[] {
  const sources = useSessionSources();
  const hosts = useHosts();
  return useMemo(() => {
    const labels = new Map(hosts.map((host) => [host.serverId, host.label]));
    const rows: MonoChatRow[] = [];
    for (const { serverId, agents, workspaces } of sources) {
      for (const agent of agents.values()) {
        if (agent.archivedAt || agent.parentAgentId) continue;
        const workspace = agent.workspaceId ? workspaces.get(agent.workspaceId) : undefined;
        rows.push(
          toChatRow({ serverId, agent, workspace, hostLabel: labels.get(serverId) ?? serverId }),
        );
      }
    }
    return rows.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  }, [hosts, sources]);
}

/** A one-row lookup for the conversation card; null until the agent is in the store. */
export function useMonoChatRow(serverId: string, agentId: string): MonoChatRow | null {
  const agent = useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId));
  const workspace = useSessionStore((state) =>
    agent?.workspaceId ? state.sessions[serverId]?.workspaces.get(agent.workspaceId) : undefined,
  );
  const hosts = useHosts();
  return useMemo(() => {
    if (!agent) return null;
    const hostLabel = hosts.find((host) => host.serverId === serverId)?.label ?? serverId;
    return toChatRow({ serverId, agent, workspace, hostLabel });
  }, [agent, hosts, serverId, workspace]);
}

/** Whether any host has sent its agent list, so an empty table means "no chats", not "loading". */
export function useAgentsHydrated(): boolean {
  return useSessionStore((state) =>
    Object.values(state.sessions).some((session) => session.hasHydratedAgents),
  );
}

/** Wall clock that ticks once a second while `live`, so running durations count up. */
export function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  return now;
}

/** How long the row's current or latest turn ran. */
export function turnDurationMs(row: MonoChatRow, now: number): number | null {
  if (!row.turnStartedAt) return null;
  const end = row.bucket === "running" ? now : row.updatedAt.getTime();
  return Math.max(0, end - row.turnStartedAt.getTime());
}
