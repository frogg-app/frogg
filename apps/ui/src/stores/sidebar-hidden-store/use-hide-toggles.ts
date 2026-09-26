import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useSidebarHiddenStore } from "./index";

/**
 * Hide / unhide with the confirmation every surface shares: hiding says where the row went and
 * offers Undo, because a row that silently vanishes reads as data loss. Unhiding is its own proof.
 */
export function useSidebarHideToggles(): {
  toggleProject: (viewKey: string) => void;
  toggleWorkspace: (workspaceKey: string) => void;
} {
  const { t } = useTranslation();
  const toast = useToast();

  const announce = useCallback(
    (wasHidden: boolean, message: string, undo: () => void) => {
      if (wasHidden) return;
      toast.show(message, {
        testID: "sidebar-hidden-toast",
        action: { label: t("sidebar.hidden.undo"), onPress: undo },
      });
    },
    [t, toast],
  );

  const toggleProject = useCallback(
    (viewKey: string) => {
      const store = useSidebarHiddenStore.getState();
      const wasHidden = store.hiddenProjectKeys.has(viewKey);
      store.toggleProjectHidden(viewKey);
      announce(wasHidden, t("sidebar.hidden.projectHidden"), () =>
        useSidebarHiddenStore.getState().toggleProjectHidden(viewKey),
      );
    },
    [announce, t],
  );

  const toggleWorkspace = useCallback(
    (workspaceKey: string) => {
      const store = useSidebarHiddenStore.getState();
      const wasHidden = store.hiddenWorkspaceKeys.has(workspaceKey);
      store.toggleWorkspaceHidden(workspaceKey);
      announce(wasHidden, t("sidebar.hidden.workspaceHidden"), () =>
        useSidebarHiddenStore.getState().toggleWorkspaceHidden(workspaceKey),
      );
    },
    [announce, t],
  );

  return { toggleProject, toggleWorkspace };
}
