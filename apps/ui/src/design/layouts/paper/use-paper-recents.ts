import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";

export interface PaperRecent {
  serverId: string;
  workspaceId: string;
  title: string;
  /** The project a workspace belongs to; null for a project-less chat. */
  projectName: string | null;
  status: WorkspaceDescriptor["status"];
  pinned: boolean;
  sortTime: number;
}

const RECENTS_LIMIT = 40;

function toTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

/** The label Paper shows for a workspace: its given title, else its name (chat title or branch). */
export function paperWorkspaceTitle(workspace: Pick<WorkspaceDescriptor, "title" | "name">) {
  return workspace.title?.trim() || workspace.name;
}

function toRecent(serverId: string, workspace: WorkspaceDescriptor): PaperRecent {
  return {
    serverId,
    workspaceId: workspace.id,
    title: paperWorkspaceTitle(workspace),
    projectName: workspace.chat
      ? null
      : workspace.projectCustomName?.trim() || workspace.projectDisplayName || null,
    status: workspace.status,
    pinned: workspace.pinnedAt != null,
    sortTime: Math.max(
      toTime(workspace.activityAt),
      toTime(workspace.statusEnteredAt),
      toTime(workspace.createdAt),
    ),
  };
}

function sameRecents(left: PaperRecent[], right: PaperRecent[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index]!;
      return (
        item.serverId === other.serverId &&
        item.workspaceId === other.workspaceId &&
        item.title === other.title &&
        item.projectName === other.projectName &&
        item.status === other.status &&
        item.pinned === other.pinned
      );
    })
  );
}

/**
 * Every live session across hosts, chats and project workspaces alike, newest first: Claude's
 * flat Recents list rather than the project tree.
 */
export function usePaperRecents(): PaperRecent[] {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const items: PaperRecent[] = [];
      for (const [serverId, session] of Object.entries(state.sessions)) {
        for (const workspace of session?.workspaces.values() ?? []) {
          if (!workspace.archivingAt) items.push(toRecent(serverId, workspace));
        }
      }
      return items.sort((left, right) => right.sortTime - left.sortTime).slice(0, RECENTS_LIMIT);
    },
    sameRecents,
  );
}

/** The host a new chat goes to: the first connected host that can run chats. */
export function usePaperChatServerId(preferred: string | null): string | null {
  return useSessionStore((state) => {
    const canRunChats = (serverId: string) =>
      state.sessions[serverId]?.serverInfo?.features?.chats === true;
    if (preferred && canRunChats(preferred)) return preferred;
    return Object.keys(state.sessions).find(canRunChats) ?? null;
  });
}
