import type { ReactElement } from "react";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { SidebarWorkspaceMenu } from "@/components/sidebar/sidebar-workspace-menu";
import { SidebarWorkspaceQuickActions } from "@/components/sidebar/workspace-quick-actions";
import { useOpenKebabMenuVisibility } from "@/components/sidebar/use-open-kebab-menu-visibility";
import {
  resolveTrailingActionVisibility,
  SidebarWorkspaceTrailingActionBase,
  SidebarWorkspaceTrailingActionOverlay,
  SidebarWorkspaceTrailingActionSlot,
} from "@/components/sidebar/sidebar-workspace-row-content";
import {
  SidebarWorkspaceTrailingContent,
  type SidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";

/**
 * The trailing cluster of a sidebar workspace row: the diff stat or timestamp, and over it
 * either the 3-dot kebab or — while Alt is held — the quick action rail it expands into.
 *
 * One component for all three row renderers (project mode's two and status mode's one). They
 * used to keep a copy each of the slot/base/overlay sandwich, which is exactly how the rule
 * about what shows when drifted the last time.
 */
export function SidebarWorkspaceTrailingActions({
  workspace,
  backdrop,
  trailing,
  selected,
  isHovered,
  isTouchPlatform,
  showShortcut,
  isPinned,
  onTogglePin,
  onCopySessionId,
  onCopyBranchName,
  onRename,
  onMarkAsRead,
  onArchive,
  archiveLabel,
  archiveStatus,
  archivePendingLabel,
  archiveShortcutKeys,
  openInFileManagerPath,
}: {
  workspace: SidebarWorkspaceEntry;
  backdrop: SidebarSurfaceBackdrop;
  trailing: SidebarWorkspaceTrailing;
  selected: boolean;
  isHovered: boolean;
  isTouchPlatform: boolean;
  showShortcut: boolean;
  isPinned?: boolean;
  onTogglePin?: () => void;
  onCopySessionId?: () => void;
  onCopyBranchName?: () => void;
  onRename?: () => void;
  onMarkAsRead?: () => void;
  onArchive?: () => void;
  archiveLabel?: string;
  archiveStatus?: "idle" | "pending" | "success";
  archivePendingLabel?: string;
  archiveShortcutKeys?: ShortcutKey[][] | null;
  openInFileManagerPath?: string | null;
}): ReactElement | null {
  // A one-boolean selector so a held Alt re-renders this cluster and nothing above it. The
  // rows themselves, their titles and their meta lines stay untouched.
  const quickActionsModifierDown = useKeyboardShortcutsStore(
    (state) => state.quickActionsModifierDown,
  );
  const { showTrailing, showKebab, showQuickActions, showScrim, renderSlot, reserveSlotWidth } =
    resolveTrailingActionVisibility({
      workspace,
      trailing,
      hasArchiveAction: Boolean(onArchive),
      isHovered,
      isTouchPlatform,
      showShortcut,
      selected,
      quickActionsModifierDown,
    });
  const kebab = useOpenKebabMenuVisibility(showKebab);
  // An open kebab menu keeps its trigger mounted, and swapping the rail in underneath it would
  // pull the menu's anchor out from under it mid-interaction.
  const railWins = showQuickActions && !kebab.showKebab;

  if (!renderSlot) return null;

  let overlayContent: ReactElement | null = null;
  if (railWins && onArchive && onCopySessionId) {
    overlayContent = (
      <SidebarWorkspaceQuickActions
        workspaceKey={workspace.workspaceKey}
        serverId={workspace.serverId}
        workspaceId={workspace.workspaceId}
        workspaceLabels={workspace.labels}
        isPinned={isPinned}
        onRename={onRename}
        onTogglePin={onTogglePin}
        onCopySessionId={onCopySessionId}
        onArchive={onArchive}
        archiveLabel={archiveLabel}
      />
    );
  } else if (kebab.showKebab && onArchive) {
    overlayContent = (
      <SidebarWorkspaceMenu
        {...kebab.menuProps}
        workspaceKey={workspace.workspaceKey}
        serverId={workspace.serverId}
        workspaceId={workspace.workspaceId}
        workspaceLabels={workspace.labels}
        onCopySessionId={onCopySessionId}
        onCopyBranchName={onCopyBranchName}
        onRename={onRename}
        onMarkAsRead={onMarkAsRead}
        onArchive={onArchive}
        archiveLabel={archiveLabel}
        archiveStatus={archiveStatus}
        archivePendingLabel={archivePendingLabel}
        archiveShortcutKeys={archiveShortcutKeys}
        isPinned={isPinned}
        onTogglePin={onTogglePin}
        openInFileManagerPath={openInFileManagerPath}
      />
    );
  }

  return (
    <SidebarWorkspaceTrailingActionSlot reserveWidth={reserveSlotWidth}>
      <SidebarWorkspaceTrailingActionBase visible={showTrailing}>
        <SidebarWorkspaceTrailingContent workspace={workspace} trailing={trailing} />
      </SidebarWorkspaceTrailingActionBase>
      <SidebarWorkspaceTrailingActionOverlay
        visible={kebab.showKebab || railWins}
        scrimBackdrop={showScrim ? backdrop : undefined}
      >
        {overlayContent}
      </SidebarWorkspaceTrailingActionOverlay>
    </SidebarWorkspaceTrailingActionSlot>
  );
}
