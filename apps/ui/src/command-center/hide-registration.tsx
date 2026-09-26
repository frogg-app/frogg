import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff } from "lucide-react-native";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSidebarHiddenStore } from "@/stores/sidebar-hidden-store";
import { useSidebarHideToggles } from "@/stores/sidebar-hidden-store/use-hide-toggles";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { buildHideCommandCenterContributions } from "./hide-contributions";
import { getCommandCenterIcon } from "./icon";
import { useCommandCenterActions } from "./provider";

const ICONS = { hide: getCommandCenterIcon(EyeOff), unhide: getCommandCenterIcon(Eye) };

/**
 * Registered inside `SidebarModelProvider`, because the project a workspace sits under is a
 * sidebar notion (`projectViewKey`) that only the sidebar model can answer.
 */
export function CommandCenterHideActions() {
  const { t } = useTranslation();
  const selection = useActiveWorkspaceSelection();
  const { workspacePlacements, hiddenCount } = useSidebarModel();
  const hiddenProjectKeys = useSidebarHiddenStore((state) => state.hiddenProjectKeys);
  const hiddenWorkspaceKeys = useSidebarHiddenStore((state) => state.hiddenWorkspaceKeys);
  const showHidden = useSidebarHiddenStore((state) => state.showHidden);
  const setShowHidden = useSidebarHiddenStore((state) => state.setShowHidden);
  const { toggleProject, toggleWorkspace } = useSidebarHideToggles();

  const workspaceKey = selection
    ? buildWorkspaceTabPersistenceKey({
        serverId: selection.serverId,
        workspaceId: selection.workspaceId,
      })
    : null;
  const projectViewKey = useMemo(
    () =>
      workspaceKey
        ? (workspacePlacements.find((placement) => placement.workspaceKey === workspaceKey)
            ?.projectViewKey ?? null)
        : null,
    [workspaceKey, workspacePlacements],
  );

  const actions = useMemo(
    () =>
      buildHideCommandCenterContributions({
        workspace: workspaceKey
          ? { workspaceKey, isHidden: hiddenWorkspaceKeys.has(workspaceKey) }
          : null,
        project: projectViewKey
          ? { viewKey: projectViewKey, isHidden: hiddenProjectKeys.has(projectViewKey) }
          : null,
        hiddenCount,
        showHidden,
        labels: {
          section: t("workspace.header.actions.workspaceActions"),
          hideWorkspace: t("sidebar.workspace.actions.hide"),
          unhideWorkspace: t("sidebar.workspace.actions.unhide"),
          hideProject: t("sidebar.project.actions.hide"),
          unhideProject: t("sidebar.project.actions.unhide"),
          showHidden: t("sidebar.hidden.show", { count: hiddenCount }),
          stopShowingHidden: t("sidebar.hidden.stopShowing"),
        },
        icons: ICONS,
        toggleWorkspace,
        toggleProject,
        setShowHidden,
      }),
    [
      hiddenCount,
      hiddenProjectKeys,
      hiddenWorkspaceKeys,
      projectViewKey,
      setShowHidden,
      showHidden,
      t,
      toggleProject,
      toggleWorkspace,
      workspaceKey,
    ],
  );

  useCommandCenterActions({ sourceId: "sidebar-hide", enabled: true, actions });
  return null;
}
