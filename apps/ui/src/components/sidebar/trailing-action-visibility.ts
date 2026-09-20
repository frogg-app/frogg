import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarWorkspaceTrailing } from "@/hooks/use-settings";

// Pure, so it can be unit tested without loading the row's native dependencies.

/** Whether the slot has anything to draw for this workspace under the current preference. */
export function hasSidebarWorkspaceTrailing({
  workspace,
  trailing,
}: {
  workspace: Pick<SidebarWorkspaceEntry, "diffStat" | "statusEnteredAt">;
  trailing: SidebarWorkspaceTrailing;
}): boolean {
  if (trailing === "diff") return workspace.diffStat !== null;
  if (trailing === "timestamp") return workspace.statusEnteredAt !== null;
  return false;
}

/**
 * What the trailing cluster shows for a row. Derived in one place because three row renderers
 * share it: the two project-mode rows and the status-mode row. The rule used to be copied
 * into each of them and immediately drifted — one call site kept hiding the diff after the
 * others stopped.
 *
 * Right to left the cluster is: the actions column (kebab, or the Control rail), the account,
 * then the diff stat or timestamp. The kebab has a column of its own, so it never sits on top
 * of the metadata; only the wider rail does, over a scrim that fades what is under it.
 */
function resolveShowQuickActions(input: {
  quickActionsModifierDown: boolean;
  targeted: boolean;
  hasArchiveAction: boolean;
  isTouchPlatform: boolean;
}): boolean {
  return (
    input.quickActionsModifierDown &&
    input.targeted &&
    input.hasArchiveAction &&
    !input.isTouchPlatform
  );
}

export function resolveTrailingActionVisibility({
  workspace,
  trailing,
  hasArchiveAction,
  isHovered,
  isTouchPlatform,
  showShortcut,
  selected = false,
  quickActionsModifierDown = false,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
  hasArchiveAction: boolean;
  isHovered: boolean;
  isTouchPlatform: boolean;
  showShortcut: boolean;
  /** Whether this is the row the sidebar currently has open. */
  selected?: boolean;
  /** Control is held. Whether that reaches this particular row is decided below. */
  quickActionsModifierDown?: boolean;
}): {
  showTrailing: boolean;
  showKebab: boolean;
  showQuickActions: boolean;
  showScrim: boolean;
  /** The row holds a fixed-width column at its right edge for the kebab and the rail. */
  showActionsColumn: boolean;
  /** Whether that column takes layout width instead of overlaying the row's metadata. */
  reserveActionsColumn: boolean;
} {
  const hasTrailing = hasSidebarWorkspaceTrailing({ workspace, trailing });
  // The rail is the kebab expanded, so it needs the same actions the kebab would have opened.
  // It coexists with the workspace-jump number badge rather than replacing it: the badge keeps
  // the row's right edge and the rail is offset to start left of it, so holding Control still
  // advertises the quick-swap key.
  //
  // Only the selected row and the hovered row get it. Every row at once would be a wall of
  // icons with no answer to "which session does this act on", and the two rows a user can
  // already point at are the two they mean. Touch is excluded outright: no key to hold, and
  // no hover to scope it with.
  const showQuickActions = resolveShowQuickActions({
    quickActionsModifierDown,
    targeted: selected || isHovered,
    hasArchiveAction,
    isTouchPlatform,
  });
  const showKebab =
    Boolean(hasArchiveAction && (isHovered || isTouchPlatform)) &&
    !showShortcut &&
    !showQuickActions;
  return {
    // Always drawn now that nothing shares its space; the rail's scrim fades it when it covers it.
    showTrailing: hasTrailing,
    showKebab,
    showQuickActions,
    // Only the rail is wider than its column, so only the rail needs the metadata faded out
    // from under it. It scrims on a selected row too: `selected` paints its own background,
    // so the gradient has a real colour to fade into.
    showScrim: showQuickActions,
    // Held on every row with actions, hovered or not, so the kebab appearing never reflows
    // the title and the metadata; on touch it is where the permanent kebab lives.
    showActionsColumn: hasArchiveAction,
    // A pointer platform reveals the kebab on hover, so its column overlays the row and the
    // title keeps the full width. Touch has no hover: the kebab is always drawn, so it must
    // take real width or it sits on top of the account and the diff stat.
    reserveActionsColumn: hasArchiveAction && isTouchPlatform,
  };
}
