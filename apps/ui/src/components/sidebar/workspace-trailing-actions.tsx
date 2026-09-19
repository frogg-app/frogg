import { useMemo, type ReactElement } from "react";
import { Animated, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { useAppSettings } from "@/hooks/use-settings";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { TrailingActionScrim } from "@/components/ui/trailing-action-scrim";
import { SidebarWorkspaceMenu } from "@/components/sidebar/sidebar-workspace-menu";
import {
  QUICK_ACTIONS_EXPANDED_WIDTH,
  SidebarWorkspaceQuickActions,
} from "@/components/sidebar/workspace-quick-actions";
import { useOpenKebabMenuVisibility } from "@/components/sidebar/use-open-kebab-menu-visibility";
import { resolveTrailingActionVisibility } from "@/components/sidebar/trailing-action-visibility";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import { SidebarWorkspaceAccountIndicator } from "@/components/sidebar/workspace-account";
import { WorkspaceAgentDisclosure } from "@/components/sidebar/agents/workspace-tree";
import { useFadePresence } from "@/components/sidebar/use-fade-presence";
import {
  SidebarWorkspaceTrailingContent,
  type SidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";

/**
 * The actions column's width: the kebab trigger's painted footprint (a 14px icon, 2px padding
 * each side, 2px lead-in) less the 7px it is pulled right onto the row's trailing edge.
 */
export const SIDEBAR_ROW_ACTIONS_COLUMN_WIDTH = 13;
/** How much of the rail's scrim is gradient before it turns solid under the icons. */
const RAIL_SCRIM_FADE_WIDTH = 24;
const RAIL_SCRIM_WIDTH = QUICK_ACTIONS_EXPANDED_WIDTH + RAIL_SCRIM_FADE_WIDTH;

/**
 * The trailing cluster of a sidebar workspace row, right to left: the actions column, the
 * account, the agent disclosure, then the diff stat or timestamp.
 *
 * The actions column is a fixed width at the row's right edge on every row that has actions.
 * The 3-dot kebab fades into it on hover. Holding Alt cross-fades the kebab into the quick
 * action rail, which is pinned to that same right edge — so it lands on the exact same pixels
 * on every row whatever the title and metadata are — and grows leftwards over a scrim that
 * fades out whatever it covers. Nothing it does changes the title's width.
 *
 * One component for all three row renderers (project mode's two and status mode's one). They
 * used to keep a copy each, which is exactly how the rule about what shows when drifted.
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
  const { showTrailing, showKebab, showQuickActions, showActionsColumn } =
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
  const railWins = showQuickActions && !kebab.showKebab && Boolean(onArchive && onCopySessionId);
  const kebabPresence = useFadePresence(kebab.showKebab);
  const railPresence = useFadePresence(railWins);
  const kebabStyle = useMemo(
    () => [styles.kebab, { opacity: kebabPresence.progress }],
    [kebabPresence.progress],
  );
  const railLayerStyle = useMemo(
    () => [styles.railLayer, { opacity: railPresence.progress }],
    [railPresence.progress],
  );
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource });

  return (
    <>
      {showTrailing ? (
        <View style={styles.trailingContent} testID="sidebar-workspace-trailing-meta">
          <SidebarWorkspaceTrailingContent workspace={workspace} trailing={trailing} />
        </View>
      ) : null}
      <SidebarWorkspaceAccountIndicator serverId={workspace.serverId} />
      <WorkspaceAgentDisclosure label={workspaceLabel} />
      {showActionsColumn && onArchive ? (
        <View
          style={styles.actionsColumn}
          testID={`sidebar-workspace-actions-${workspace.workspaceKey}`}
        >
          {kebabPresence.mounted ? (
            <Animated.View style={kebabStyle} pointerEvents={kebab.showKebab ? "auto" : "none"}>
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
            </Animated.View>
          ) : null}
          {railPresence.mounted && onCopySessionId ? (
            <Animated.View
              style={railLayerStyle}
              pointerEvents={railWins ? "box-none" : "none"}
              testID={`sidebar-workspace-quick-actions-layer-${workspace.workspaceKey}`}
            >
              {/* Fades with the rail, including on the way out, so the metadata it covers
                  comes back as the icons go rather than a frame before or after. */}
              <TrailingActionScrim
                backdrop={backdrop}
                width={RAIL_SCRIM_WIDTH}
                fadeWidth={RAIL_SCRIM_FADE_WIDTH}
                testID="sidebar-workspace-trailing-scrim"
              />
              <SidebarWorkspaceQuickActions
                progress={railPresence.progress}
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
            </Animated.View>
          ) : null}
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  trailingContent: {
    flexShrink: 0,
  },
  // Fixed, not content-sized, and present whether or not anything is showing in it: the kebab
  // and the rail both anchor to its right edge, which is the row's right edge.
  actionsColumn: {
    position: "relative",
    width: SIDEBAR_ROW_ACTIONS_COLUMN_WIDTH,
    height: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  kebab: {
    flexDirection: "row",
  },
  // Pinned to the column's right edge and sized to the rail, so it grows leftwards over the
  // metadata and title without taking layout space from either.
  railLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    height: 20,
    width: RAIL_SCRIM_WIDTH,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },
});
