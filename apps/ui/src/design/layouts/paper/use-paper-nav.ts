import { router, usePathname } from "expo-router";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useHostChooser } from "@/hosts/host-chooser";
import {
  navigateToWorkspace,
  useActiveWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import {
  buildOpenProjectRoute,
  buildProjectsSettingsRoute,
  buildSessionsRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import type { PaperRecent } from "./use-paper-recents";

/**
 * The Paper sidebar's destinations, all through the app's existing routes and actions.
 * `onBeforeNavigate` lets the mobile drawer close itself first.
 */
export function usePaperNav(onBeforeNavigate?: () => void) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const chooseHost = useHostChooser();
  const selection = useActiveWorkspaceSelection();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);

  const go = useCallback(
    (route: string) => {
      onBeforeNavigate?.();
      router.push(route as never);
    },
    [onBeforeNavigate],
  );

  // Claude's New chat returns to the greeting and composer; Paper's home is that screen.
  const newChat = useCallback(() => go(buildOpenProjectRoute()), [go]);
  const history = useCallback(() => go(buildSessionsRoute()), [go]);
  const settings = useCallback(() => go(buildSettingsRoute()), [go]);
  const search = useCallback(() => {
    onBeforeNavigate?.();
    setCommandCenterOpen(true);
  }, [onBeforeNavigate, setCommandCenterOpen]);
  const projects = useCallback(() => {
    chooseHost({
      title: t("sidebar.sections.projects"),
      onChooseHost: (serverId) => go(buildProjectsSettingsRoute(serverId)),
    });
  }, [chooseHost, go, t]);
  const openRecent = useCallback(
    (item: PaperRecent) => {
      onBeforeNavigate?.();
      navigateToWorkspace({ serverId: item.serverId, workspaceId: item.workspaceId });
    },
    [onBeforeNavigate],
  );

  const activeKey = selection ? `${selection.serverId}:${selection.workspaceId}` : null;
  const current = useMemo(
    () => ({
      home: pathname === buildOpenProjectRoute(),
      history: pathname.includes("/sessions"),
      projects: pathname.includes("/projects"),
    }),
    [pathname],
  );

  return { newChat, history, settings, search, projects, openRecent, activeKey, current };
}
