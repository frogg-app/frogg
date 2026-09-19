import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as Clipboard from "expo-clipboard";
import { toSessionId } from "@frogg/protocol/session-id";
import { useToast } from "@/contexts/toast-context";

// Everything the copy actions actually need. Kept narrower than SidebarWorkspaceEntry so the
// command center can build one from the active route selection without a sidebar row.
export interface CopyableWorkspace {
  workspaceId: string;
  currentBranch: string | null | undefined;
}

export interface WorkspaceClipboardActions {
  /**
   * The session's short ID. This is the primary way to name a session: every session has one,
   * whereas a branch name only exists when the session happens to be a git worktree.
   */
  copySessionId: (workspace: CopyableWorkspace) => void;
  copyBranchName: (workspace: CopyableWorkspace) => void;
}

export function useWorkspaceClipboardActions(): WorkspaceClipboardActions {
  const { t } = useTranslation();
  const toast = useToast();

  const copySessionId = useCallback(
    (workspace: CopyableWorkspace) => {
      // Derived, never stored. Going through the one helper is what makes the ID copied here
      // the same ID every other surface shows for the same session.
      void Clipboard.setStringAsync(toSessionId(workspace.workspaceId));
      toast.copied(t("sidebar.workspace.toasts.sessionIdCopied"));
    },
    [t, toast],
  );

  const copyBranchName = useCallback(
    (workspace: CopyableWorkspace) => {
      if (!workspace.currentBranch) {
        return;
      }
      void Clipboard.setStringAsync(workspace.currentBranch);
      toast.copied(t("sidebar.workspace.toasts.branchNameCopied"));
    },
    [t, toast],
  );

  return useMemo(() => ({ copySessionId, copyBranchName }), [copyBranchName, copySessionId]);
}
