import type { CommandCenterContribution, CommandCenterIcon } from "./contributions";

export interface HideCommandCenterSource {
  /** The routed workspace, when there is one. */
  workspace: { workspaceKey: string; isHidden: boolean } | null;
  project: { viewKey: string; isHidden: boolean } | null;
  hiddenCount: number;
  showHidden: boolean;
  labels: {
    section: string;
    hideWorkspace: string;
    unhideWorkspace: string;
    hideProject: string;
    unhideProject: string;
    showHidden: string;
    stopShowingHidden: string;
  };
  icons: { hide?: CommandCenterIcon; unhide?: CommandCenterIcon };
  toggleWorkspace(workspaceKey: string): void;
  toggleProject(viewKey: string): void;
  setShowHidden(showHidden: boolean): void;
}

/**
 * Hide and unhide from the command center. They sit in the workspace section beside Pin, since
 * they act on the same routed workspace; the show-hidden toggle only exists once something is
 * hidden, so the list never offers a switch that does nothing.
 */
export function buildHideCommandCenterContributions(
  source: HideCommandCenterSource,
): CommandCenterContribution[] {
  const contributions: CommandCenterContribution[] = [];
  const action = (input: {
    id: string;
    rank: number;
    title: string;
    keywords: readonly string[];
    icon?: CommandCenterIcon;
    visibility: "always" | "query";
    run: () => void;
  }): CommandCenterContribution => ({
    id: input.id,
    group: "workspace",
    groupRank: -1,
    rank: input.rank,
    keywords: input.keywords,
    visibility: input.visibility,
    run: input.run,
    presentation: {
      kind: "action",
      title: input.title,
      sectionTitle: source.labels.section,
      icon: input.icon,
    },
  });

  const { workspace, project } = source;
  if (workspace) {
    contributions.push(
      action({
        id: "workspace:hide",
        rank: 20.5,
        title: workspace.isHidden ? source.labels.unhideWorkspace : source.labels.hideWorkspace,
        keywords: ["hide", "unhide", "show", "sidebar", "workspace", "session"],
        icon: workspace.isHidden ? source.icons.unhide : source.icons.hide,
        visibility: "always",
        run: () => source.toggleWorkspace(workspace.workspaceKey),
      }),
    );
  }
  if (project) {
    contributions.push(
      action({
        id: "workspace:hide-project",
        rank: 20.6,
        title: project.isHidden ? source.labels.unhideProject : source.labels.hideProject,
        keywords: ["hide", "unhide", "show", "sidebar", "project"],
        icon: project.isHidden ? source.icons.unhide : source.icons.hide,
        visibility: "query",
        run: () => source.toggleProject(project.viewKey),
      }),
    );
  }
  if (source.hiddenCount > 0 || source.showHidden) {
    contributions.push(
      action({
        id: "sidebar:show-hidden",
        rank: 20.7,
        title: source.showHidden ? source.labels.stopShowingHidden : source.labels.showHidden,
        keywords: ["hidden", "show", "unhide", "reveal", "sidebar", "projects", "workspaces"],
        icon: source.showHidden ? source.icons.hide : source.icons.unhide,
        visibility: "query",
        run: () => source.setShowHidden(!source.showHidden),
      }),
    );
  }
  return contributions;
}
