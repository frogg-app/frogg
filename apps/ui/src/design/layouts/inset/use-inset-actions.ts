import { router } from "expo-router";
import { useCallback, useMemo } from "react";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { buildOpenProjectRoute, buildSettingsRoute } from "@/utils/host-routes";
import { useInsetViewStore, type InsetView } from "./inset-data";

/**
 * The shipping app's own handlers, bundled for the inset regions. `beforeNavigate` runs ahead of
 * every action that leaves the current surface (closing the mobile drawer, for one).
 */
export function useInsetActions(beforeNavigate?: () => void) {
  const dispatcher = useKeyboardActionDispatcher();
  const openAddProject = useOpenAddProject();
  const setView = useInsetViewStore((state) => state.setView);

  const newSession = useCallback(() => {
    beforeNavigate?.();
    dispatcher.dispatch({ id: "workspace.new", scope: "sidebar" });
  }, [beforeNavigate, dispatcher]);

  const search = useCallback(() => {
    beforeNavigate?.();
    useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
  }, [beforeNavigate]);

  const addProject = useCallback(() => {
    beforeNavigate?.();
    openAddProject();
  }, [beforeNavigate, openAddProject]);

  const openSettings = useCallback(() => {
    beforeNavigate?.();
    router.push(buildSettingsRoute());
  }, [beforeNavigate]);

  const openView = useCallback(
    (view: InsetView) => {
      beforeNavigate?.();
      setView(view);
      router.push(buildOpenProjectRoute());
    },
    [beforeNavigate, setView],
  );

  const openWorkspace = useCallback(
    (serverId: string, workspaceId: string) => {
      beforeNavigate?.();
      navigateToWorkspace({ serverId, workspaceId });
    },
    [beforeNavigate],
  );

  return useMemo(
    () => ({ newSession, search, addProject, openSettings, openView, openWorkspace }),
    [addProject, newSession, openSettings, openView, openWorkspace, search],
  );
}
