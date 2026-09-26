import { z } from "zod";

/**
 * Projects and workspaces this device has hidden from its own sidebar.
 *
 * Purely local: several people can share one daemon, and what one of them is
 * not involved in is nobody else's business, so nothing here goes on the wire.
 * Projects are keyed by `SidebarProjectEntry.viewKey` (the same key the
 * project filter uses), workspaces by `SidebarWorkspaceEntry.workspaceKey`.
 *
 * Like the project filter, nothing ever prunes a stored key: absence from the
 * list usually just means that host has not connected yet.
 */
export interface SidebarHiddenState {
  hiddenProjectKeys: ReadonlySet<string>;
  hiddenWorkspaceKeys: ReadonlySet<string>;
  /** Temporarily reveal hidden rows, so they can be unhidden. */
  showHidden: boolean;
}

export const PersistedSidebarHiddenSchema = z.strictObject({
  hiddenProjectKeys: z.array(z.string()),
  hiddenWorkspaceKeys: z.array(z.string()),
  showHidden: z.boolean(),
});
export type PersistedSidebarHidden = z.infer<typeof PersistedSidebarHiddenSchema>;

function toggle(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function toggleProjectHidden<T extends SidebarHiddenState>(state: T, key: string): T {
  return { ...state, hiddenProjectKeys: toggle(state.hiddenProjectKeys, key) };
}

export function toggleWorkspaceHidden<T extends SidebarHiddenState>(state: T, key: string): T {
  return { ...state, hiddenWorkspaceKeys: toggle(state.hiddenWorkspaceKeys, key) };
}

export function serializeSidebarHidden(state: SidebarHiddenState): PersistedSidebarHidden {
  return {
    hiddenProjectKeys: [...state.hiddenProjectKeys],
    hiddenWorkspaceKeys: [...state.hiddenWorkspaceKeys],
    showHidden: state.showHidden,
  };
}

export function mergePersistedSidebarHidden<T extends SidebarHiddenState>(
  persisted: unknown,
  current: T,
): T {
  const parsed = PersistedSidebarHiddenSchema.safeParse(persisted);
  if (!parsed.success) return current;
  return {
    ...current,
    hiddenProjectKeys: new Set(parsed.data.hiddenProjectKeys),
    hiddenWorkspaceKeys: new Set(parsed.data.hiddenWorkspaceKeys),
    showHidden: parsed.data.showHidden,
  };
}

interface HideableProject<W extends { workspaceKey: string }> {
  viewKey: string;
  workspaces: readonly W[];
}

/**
 * The sidebar's projects with hidden ones removed: a hidden project goes with
 * all of its workspaces, a hidden workspace just leaves its project. A project
 * whose every workspace is hidden keeps its header, exactly as an empty project
 * does, so it can still be hidden or have a workspace created under it.
 */
export function filterHiddenProjects<
  W extends { workspaceKey: string },
  P extends HideableProject<W>,
>(projects: readonly P[], state: SidebarHiddenState): readonly P[] {
  if (state.showHidden) return projects;
  if (state.hiddenProjectKeys.size === 0 && state.hiddenWorkspaceKeys.size === 0) return projects;
  const result: P[] = [];
  for (const project of projects) {
    if (state.hiddenProjectKeys.has(project.viewKey)) continue;
    const workspaces = project.workspaces.filter(
      (workspace) => !state.hiddenWorkspaceKeys.has(workspace.workspaceKey),
    );
    result.push(
      workspaces.length === project.workspaces.length ? project : { ...project, workspaces },
    );
  }
  return result;
}

/** Hidden keys that still name something the sidebar can see: what "Show hidden (N)" counts. */
export function countHidden(
  projects: readonly HideableProject<{ workspaceKey: string }>[],
  state: SidebarHiddenState,
): number {
  let count = 0;
  for (const project of projects) {
    if (state.hiddenProjectKeys.has(project.viewKey)) {
      count += 1;
      continue;
    }
    for (const workspace of project.workspaces) {
      if (state.hiddenWorkspaceKeys.has(workspace.workspaceKey)) count += 1;
    }
  }
  return count;
}
