import type { WorkspaceDescriptor } from "@/stores/session-store";

export interface SidebarChatItem {
  serverId: string;
  workspaceId: string;
  title: string;
  status: WorkspaceDescriptor["status"];
  /** Epoch ms used for ordering and date grouping. */
  sortTime: number;
}

export type SidebarChatGroupKey = "today" | "yesterday" | "previous7Days" | "older";

export interface SidebarChatGroup {
  key: SidebarChatGroupKey;
  items: SidebarChatItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function toSidebarChatItem(
  serverId: string,
  workspace: WorkspaceDescriptor,
): SidebarChatItem {
  return {
    serverId,
    workspaceId: workspace.id,
    title: workspace.name,
    status: workspace.status,
    sortTime: Math.max(
      toTime(workspace.activityAt),
      toTime(workspace.statusEnteredAt),
      toTime(workspace.createdAt),
    ),
  };
}

/** Newest first, bucketed by local calendar day relative to `now`. Empty buckets are dropped. */
export function groupSidebarChats(input: {
  items: readonly SidebarChatItem[];
  query: string;
  now: Date;
}): SidebarChatGroup[] {
  const query = input.query.trim().toLocaleLowerCase();
  const startOfToday = new Date(input.now);
  startOfToday.setHours(0, 0, 0, 0);
  const today = startOfToday.getTime();
  const buckets: Record<SidebarChatGroupKey, SidebarChatItem[]> = {
    today: [],
    yesterday: [],
    previous7Days: [],
    older: [],
  };
  const sorted = input.items
    .filter((item) => !query || item.title.toLocaleLowerCase().includes(query))
    .sort((left, right) => right.sortTime - left.sortTime);
  for (const item of sorted) {
    if (item.sortTime >= today) buckets.today.push(item);
    else if (item.sortTime >= today - DAY_MS) buckets.yesterday.push(item);
    else if (item.sortTime >= today - 7 * DAY_MS) buckets.previous7Days.push(item);
    else buckets.older.push(item);
  }
  return (Object.keys(buckets) as SidebarChatGroupKey[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, items: buckets[key] }));
}
