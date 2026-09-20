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
import {
  WorkspaceAgentDisclosure,
  useWorkspaceAgentTree,
} from "@/components/sidebar/agents/workspace-tree";
import { useFadePresence } from "@/components/sidebar/use-fade-presence";
import { SIDEBAR_ROW_ACTIONS_COLUMN_WIDTH } from "@/components/sidebar/row-metrics";
import {
  SidebarWorkspaceTrailingContent,
  type SidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";

/**
 * The kebab's own scrim: its painted footprint plus a short gradient. Deliberately much narrower
 * than the rail's — it only has to fade out the metadata directly beneath the 3 dots.
 */
const KEBAB_SCRIM_FADE_WIDTH = 14;
const KEBAB_SCRIM_WIDTH = SIDEBAR_ROW_ACTIONS_COLUMN_WIDTH + 8 + KEBAB_SCRIM_FADE_WIDTH;

/** How much of the rail's scrim is gradient before it turns solid under the icons. */
const RAIL_SCRIM_FADE_WIDTH = 24;
const RAIL_SCRIM_WIDTH = QUICK_ACTIONS_EXPANDED_WIDTH + RAIL_SCRIM_FADE_WIDTH;
/**
 * How far left the rail starts when the row is also showing its workspace-jump number badge:
 * the badge's own width plus a gap. The badge is an overlay pinned to the row's right edge,
 * so the rail has to step aside for it rather than draw underneath it.
 */
const SHORTCUT_BADGE_CLEARANCE = 22;

/**
 * The trailing cluster of a sidebar workspace row, right to left: the actions column, the
 * account, the agent disclosure, then the diff stat or timestamp.
 *
 * The actions column is pinned to the row's right edge and takes no layout width, so the title
 * and metadata get the row's full width and nothing shifts when an action appears. The 3-dot
 * kebab fades into it on hover over a scrim. Holding Control cross-fades the kebab into the quick
 * action rail, which is pinned to that same right edge — so it lands on the exact same pixels
 * on every row whatever the title and metadata are — and grows leftwards over a scrim that
 * fades out whatever it covers. When the row is also showing its workspace-jump number badge,
 * the rail steps left of the badge instead, which keeps the quick-swap key visible. Nothing it
 * does changes the title's width.
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
  // A one-boolean selector so a held Control re-renders this cluster and nothing above it. The
  // rows themselves, their titles and their meta lines stay untouched.
  const quickActionsModifierDown = useKeyboardShortcutsStore(
    (state) => state.quickActionsModifierDown,
  );
  const { showTrailing, showKebab, showQuickActions, showActionsColumn, reserveActionsColumn } =
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
  // A row with subagents draws a disclosure chevron immediately left of the actions column. The
  // chevron is a control, so the kebab must not overlay and scrim it: those rows hold the column
  // open instead, exactly as touch does.
  const { nodes } = useWorkspaceAgentTree();
  const reserveColumn = reserveActionsColumn || nodes.length > 0;
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
    () => [
      styles.railLayer,
      { opacity: railPresence.progress, right: showShortcut ? SHORTCUT_BADGE_CLEARANCE : 0 },
    ],
    [railPresence.progress, showShortcut],
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
          style={reserveColumn ? styles.actionsColumnReserved : styles.actionsColumn}
          testID={`sidebar-workspace-actions-${workspace.workspaceKey}`}
        >
          {kebabPresence.mounted ? (
            <Animated.View style={kebabStyle} pointerEvents={kebab.showKebab ? "auto" : "none"}>
              {/* An overlaid column draws over whatever the row's metadata put under it, so it
                  scrims that out the way the rail does — only as wide as the 3 dots need, so it
                  never reaches further left than it covers. A reserved column has its own width
                  and nothing to fade. */}
              {reserveColumn ? null : (
                <TrailingActionScrim
                  backdrop={backdrop}
                  width={KEBAB_SCRIM_WIDTH}
                  fadeWidth={KEBAB_SCRIM_FADE_WIDTH}
                  testID="sidebar-workspace-kebab-scrim"
                />
              )}
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
  // Pinned to the row's right edge and out of the flow entirely: the kebab and the rail both
  // anchor to the same pixels on every row, and the title and metadata keep the full width of
  // the row instead of holding a column open for an action that is only there on hover.
  actionsColumn: {
    position: "absolute",
    top: 0,
    right: 0,
    width: SIDEBAR_ROW_ACTIONS_COLUMN_WIDTH,
    height: 20,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  // A permanent kebab (touch) or one that would otherwise cover the disclosure chevron, in the
  // flow: it has to push what is beside it left rather than land on top of it.
  actionsColumnReserved: {
    position: "relative",
    width: SIDEBAR_ROW_ACTIONS_COLUMN_WIDTH,
    height: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  kebab: {
    flexDirection: "row",
    alignItems: "center",
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
