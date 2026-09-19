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
 * What the trailing slot shows for a row. Derived in one place because three row renderers
 * share it: the two project-mode rows and the status-mode row. The rule used to be copied
 * into each of them and immediately drifted — one call site kept hiding the diff after the
 * others stopped.
 *
 * The trailing content survives the kebab on hover and fades under the scrim instead of
 * blinking out. Touch has no hover, so its permanent kebab still hides the content outright
 * rather than scrimming an unhovered row whose background doesn't match the gradient.
 */
function resolveShowQuickActions(input: {
  quickActionsModifierDown: boolean;
  targeted: boolean;
  hasArchiveAction: boolean;
  showShortcut: boolean;
  isTouchPlatform: boolean;
}): boolean {
  return (
    input.quickActionsModifierDown &&
    input.targeted &&
    input.hasArchiveAction &&
    !input.showShortcut &&
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
  /** Alt is held. Whether that reaches this particular row is decided below. */
  quickActionsModifierDown?: boolean;
}): {
  showTrailing: boolean;
  showKebab: boolean;
  showQuickActions: boolean;
  showScrim: boolean;
  renderSlot: boolean;
  reserveSlotWidth: boolean;
} {
  const hasTrailing = hasSidebarWorkspaceTrailing({ workspace, trailing });
  // The rail is the kebab expanded, so it needs the same actions the kebab would have opened,
  // and it yields to the number badges outright — one modifier, one meaning.
  //
  // Only the selected row and the hovered row get it. Every row at once would be a wall of
  // icons with no answer to "which session does this act on", and the two rows a user can
  // already point at are the two they mean. Touch is excluded outright: no key to hold, and
  // no hover to scope it with.
  const showQuickActions = resolveShowQuickActions({
    quickActionsModifierDown,
    targeted: selected || isHovered,
    hasArchiveAction,
    showShortcut,
    isTouchPlatform,
  });
  const showKebab =
    Boolean(hasArchiveAction && (isHovered || isTouchPlatform)) &&
    !showShortcut &&
    !showQuickActions;
  const showTrailing =
    hasTrailing && !showShortcut && (isHovered || !(showKebab || showQuickActions));
  return {
    showTrailing,
    showKebab,
    showQuickActions,
    // The scrim paints the row's own hover background, so it can only be drawn on a hovered
    // row — over an unhovered one the gradient fades to the wrong color. That is also why
    // touch, which shows the kebab without ever hovering, never gets one.
    // The rail scrims on a selected row too: unlike hover-only kebab reveal, `selected`
    // paints its own row background, so the gradient has a real colour to fade into.
    showScrim: (showKebab && isHovered) || showQuickActions,
    renderSlot: hasArchiveAction || hasTrailing,
    // The slot only holds width for something that permanently sits in it. Trailing content
    // does; the kebab only does on touch, where there is no hover for it to appear on and so
    // no scrim to let it overlay the title. Everywhere else the width goes back to the title
    // and the kebab fades in over its tail.
    reserveSlotWidth: hasTrailing || (hasArchiveAction && isTouchPlatform),
  };
}
