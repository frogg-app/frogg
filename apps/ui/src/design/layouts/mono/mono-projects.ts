import { useMemo } from "react";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { projectNameOf, useSessionSources } from "./mono-data";

export interface MonoProject {
  name: string;
  serverId: string;
  workspaces: WorkspaceDescriptor[];
}

export function bucketOfWorkspace(workspace: WorkspaceDescriptor): SidebarStateBucket {
  return workspace.status;
}

function activityTime(workspace: WorkspaceDescriptor): number {
  const raw = workspace.activityAt ?? workspace.createdAt;
  const time = raw ? Date.parse(raw) : 0;
  return Number.isFinite(time) ? time : 0;
}

/**
 * Projects (by display name) with their live workspaces, for one host or every host. Project-less
 * chats and archiving workspaces are left out; projects and workspaces are ordered by activity.
 */
export function useProjectIndex(serverId: string | null): MonoProject[] {
  const sources = useSessionSources();
  return useMemo(() => {
    const byName = new Map<string, MonoProject>();
    for (const source of sources) {
      if (serverId && source.serverId !== serverId) continue;
      for (const workspace of source.workspaces.values()) {
        if (workspace.chat || workspace.archivingAt) continue;
        const name = projectNameOf(workspace);
        const project = byName.get(name) ?? { name, serverId: source.serverId, workspaces: [] };
        project.workspaces.push(workspace);
        byName.set(name, project);
      }
    }
    const projects = [...byName.values()];
    for (const project of projects) {
      project.workspaces.sort((a, b) => activityTime(b) - activityTime(a));
    }
    const latest = (project: MonoProject) =>
      project.workspaces[0] ? activityTime(project.workspaces[0]) : 0;
    return projects.sort((a, b) => latest(b) - latest(a));
  }, [serverId, sources]);
}
