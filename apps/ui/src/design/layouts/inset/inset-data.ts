import { useMemo } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { create } from "zustand";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { STATUS_BUCKET_ORDER, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

/** One line of the inset list: a project session or a project-less chat. */
export interface InsetRow {
  key: string;
  serverId: string;
  workspaceId: string;
  title: string;
  /** Null for a chat, which belongs to no project. */
  projectName: string | null;
  bucket: SidebarStateBucket;
  branch: string | null;
  diffStat: { additions: number; deletions: number } | null;
  /** The most recent of last activity and status change; null when the host reported neither. */
  at: Date | null;
}

export interface InsetGroup {
  bucket: SidebarStateBucket;
  label: string;
  rows: InsetRow[];
}

/** Linear's saved views, as the sidebar nav items and the home tabs share them. */
export type InsetView = "all" | "active" | "inbox" | "running";

const VIEW_BUCKETS: Record<InsetView, ReadonlySet<SidebarStateBucket> | null> = {
  all: null,
  active: new Set(["needs_input", "failed", "attention", "running"]),
  inbox: new Set(["needs_input", "failed", "attention"]),
  running: new Set(["running"]),
};

// Preview-only view state: which saved view the inset home is showing.
export const useInsetViewStore = create<{ view: InsetView; setView: (view: InsetView) => void }>(
  (set) => ({ view: "all", setView: (view) => set({ view }) }),
);

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function latest(...dates: Array<Date | null>): Date | null {
  let best: Date | null = null;
  for (const date of dates) {
    if (date && (!best || date.getTime() > best.getTime())) best = date;
  }
  return best;
}

export function rowFromEntry(entry: SidebarWorkspaceEntry): InsetRow {
  return {
    key: entry.workspaceKey,
    serverId: entry.serverId,
    workspaceId: entry.workspaceId,
    title: entry.name,
    projectName: entry.projectName,
    bucket: entry.statusBucket,
    branch: entry.currentBranch,
    diffStat: entry.diffStat,
    at: latest(toDate(entry.activityAt), entry.statusEnteredAt),
  };
}

function rowFromChat(serverId: string, workspace: WorkspaceDescriptor): InsetRow {
  return {
    key: `${serverId}:${workspace.id}`,
    serverId,
    workspaceId: workspace.id,
    title: workspace.name,
    projectName: null,
    bucket: workspace.status,
    branch: null,
    diffStat: workspace.diffStat,
    at: latest(toDate(workspace.activityAt), workspace.statusEnteredAt),
  };
}

function sameRows(left: InsetRow[], right: InsetRow[]): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => {
      const other = right[index]!;
      return (
        row.key === other.key &&
        row.title === other.title &&
        row.bucket === other.bucket &&
        row.at?.getTime() === other.at?.getTime() &&
        row.diffStat?.additions === other.diffStat?.additions &&
        row.diffStat?.deletions === other.diffStat?.deletions
      );
    })
  );
}

/** Project-less chats on every host, which the sidebar's project model does not carry. */
export function useInsetChatRows(): InsetRow[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const rows: InsetRow[] = [];
      for (const [serverId, session] of Object.entries(state.sessions)) {
        for (const workspace of session?.workspaces.values() ?? []) {
          if (workspace.chat && !workspace.archivingAt) rows.push(rowFromChat(serverId, workspace));
        }
      }
      return rows;
    },
    sameRows,
  );
}

/** Sessions and chats together, newest first. */
export function useInsetRows(entries: ReadonlyMap<string, SidebarWorkspaceEntry>): InsetRow[] {
  const chats = useInsetChatRows();
  return useMemo(() => {
    const rows = [...entries.values()].filter((entry) => !entry.archivingAt).map(rowFromEntry);
    rows.push(...chats);
    rows.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
    return rows;
  }, [chats, entries]);
}

export function filterRows(rows: readonly InsetRow[], view: InsetView): InsetRow[] {
  const buckets = VIEW_BUCKETS[view];
  return buckets ? rows.filter((row) => buckets.has(row.bucket)) : [...rows];
}

/** Rows bucketed by status in the app's canonical order; empty groups are dropped. */
export function groupRows(rows: readonly InsetRow[]): InsetGroup[] {
  const byBucket = new Map<SidebarStateBucket, InsetRow[]>();
  for (const row of rows) {
    const list = byBucket.get(row.bucket) ?? [];
    list.push(row);
    byBucket.set(row.bucket, list);
  }
  return STATUS_BUCKET_ORDER.flatMap((bucket) => {
    const list = byBucket.get(bucket);
    return list && list.length > 0
      ? [{ bucket, label: STATUS_BUCKET_LABELS[bucket], rows: list }]
      : [];
  });
}

export function countView(rows: readonly InsetRow[], view: InsetView): number {
  const buckets = VIEW_BUCKETS[view];
  if (!buckets) return rows.length;
  let count = 0;
  for (const row of rows) if (buckets.has(row.bucket)) count += 1;
  return count;
}
