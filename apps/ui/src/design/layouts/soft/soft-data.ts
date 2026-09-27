import { useEffect, useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { getHostRuntimeStore, useHosts } from "@/runtime/host-runtime";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";

export type SoftStatus = WorkspaceDescriptor["status"];

/** One conversation in the soft lists: a workspace (a chat, or a session inside a project). */
export interface SoftRecent {
  key: string;
  serverId: string;
  workspaceId: string;
  title: string;
  /** Null for a project-less chat. */
  projectName: string | null;
  projectKey: string;
  branch: string | null;
  status: SoftStatus;
  diffStat: { additions: number; deletions: number } | null;
  /** Epoch ms of the latest activity, for ordering and relative time. */
  sortTime: number;
}

export interface SoftProject {
  key: string;
  name: string;
  serverId: string;
  recents: SoftRecent[];
  /** The most urgent status among its sessions. */
  status: SoftStatus;
  sortTime: number;
}

function toTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function toRecent(serverId: string, workspace: WorkspaceDescriptor): SoftRecent {
  const projectName = workspace.chat
    ? null
    : workspace.projectCustomName?.trim() || workspace.projectDisplayName;
  return {
    key: `${serverId}:${workspace.id}`,
    serverId,
    workspaceId: workspace.id,
    title: workspace.title?.trim() || workspace.name,
    projectName,
    projectKey: `${serverId}:${workspace.project?.projectKey ?? workspace.projectId}`,
    branch: workspace.gitRuntime?.currentBranch?.trim() || null,
    status: workspace.status,
    diffStat: workspace.diffStat,
    sortTime: Math.max(
      toTime(workspace.activityAt),
      toTime(workspace.statusEnteredAt),
      toTime(workspace.createdAt),
    ),
  };
}

function sameRecent(left: SoftRecent, right: SoftRecent): boolean {
  return (
    left.key === right.key &&
    left.title === right.title &&
    left.projectName === right.projectName &&
    left.branch === right.branch &&
    left.status === right.status &&
    left.sortTime === right.sortTime &&
    left.diffStat?.additions === right.diffStat?.additions &&
    left.diffStat?.deletions === right.diffStat?.deletions
  );
}

function sameRecents(left: SoftRecent[], right: SoftRecent[]): boolean {
  return left.length === right.length && left.every((item, i) => sameRecent(item, right[i]!));
}

/**
 * Every live workspace on every host, newest first. Holds directory demand on each host while
 * mounted, so the list fills in even when the shipping sidebar is not rendered.
 */
export function useSoftRecents(): SoftRecent[] {
  const hosts = useHosts();
  const serverIdsKey = hosts.map((host) => host.serverId).join("\n");
  useEffect(() => {
    const runtime = getHostRuntimeStore();
    const serverIds = serverIdsKey ? serverIdsKey.split("\n") : [];
    const releases = serverIds.map((serverId) => runtime.acquireDirectoryDemand(serverId));
    return () => releases.forEach((release) => release());
  }, [serverIdsKey]);

  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const items: SoftRecent[] = [];
      for (const [serverId, session] of Object.entries(state.sessions)) {
        for (const workspace of session?.workspaces.values() ?? []) {
          if (!workspace.archivingAt) items.push(toRecent(serverId, workspace));
        }
      }
      return items.sort((left, right) => right.sortTime - left.sortTime);
    },
    sameRecents,
  );
}

export type SoftDayGroup = "today" | "yesterday" | "previous7Days" | "older";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Newest-first recents bucketed by local calendar day relative to `now`; empty buckets dropped. */
export function groupByDay(recents: SoftRecent[], now: Date): { key: SoftDayGroup; items: SoftRecent[] }[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const buckets: Record<SoftDayGroup, SoftRecent[]> = {
    today: [],
    yesterday: [],
    previous7Days: [],
    older: [],
  };
  for (const recent of recents) {
    if (recent.sortTime >= today) buckets.today.push(recent);
    else if (recent.sortTime >= today - DAY_MS) buckets.yesterday.push(recent);
    else if (recent.sortTime >= today - 7 * DAY_MS) buckets.previous7Days.push(recent);
    else buckets.older.push(recent);
  }
  return (Object.keys(buckets) as SoftDayGroup[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, items: buckets[key] }));
}

// Anything the user has to act on outranks work still moving on its own; done is last.
const STATUS_PRIORITY: readonly SoftStatus[] = [
  "needs_input",
  "failed",
  "running",
  "attention",
  "done",
];

export function mostUrgentStatus(statuses: Iterable<SoftStatus>): SoftStatus {
  let best = STATUS_PRIORITY.length - 1;
  for (const status of statuses) {
    const rank = STATUS_PRIORITY.indexOf(status);
    if (rank >= 0 && rank < best) best = rank;
  }
  return STATUS_PRIORITY[best]!;
}

/** Project sessions grouped by project, most recently active project first. */
export function useSoftProjects(recents: SoftRecent[]): SoftProject[] {
  return useMemo(() => {
    const byKey = new Map<string, SoftProject>();
    for (const recent of recents) {
      if (recent.projectName === null) continue;
      const existing = byKey.get(recent.projectKey);
      if (existing) {
        existing.recents.push(recent);
        continue;
      }
      byKey.set(recent.projectKey, {
        key: recent.projectKey,
        name: recent.projectName,
        serverId: recent.serverId,
        recents: [recent],
        status: recent.status,
        sortTime: recent.sortTime,
      });
    }
    const projects = [...byKey.values()];
    for (const project of projects) {
      project.status = mostUrgentStatus(project.recents.map((recent) => recent.status));
    }
    return projects;
  }, [recents]);
}

/** The host new chats go to: the first connected host that can run chats. */
export function useSoftChatServerId(): string | null {
  return useSessionStore((state) => {
    for (const [serverId, session] of Object.entries(state.sessions)) {
      if (session?.serverInfo?.features?.chats === true) return serverId;
    }
    return null;
  });
}

// preview copy
const STATUS_LABELS: Record<SoftStatus, string> = {
  needs_input: "Needs input",
  failed: "Failed",
  running: "Working",
  attention: "Ready to review",
  done: "Done",
};

export function softStatusLabel(status: SoftStatus): string {
  return STATUS_LABELS[status];
}
