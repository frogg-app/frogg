import { describe, expect, it } from "vitest";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import { resolveTrailingActionVisibility } from "./trailing-action-visibility";

const workspace = {
  diffStat: { additions: 3, deletions: 1 },
  statusEnteredAt: null,
} as unknown as SidebarWorkspaceEntry;

function resolve(overrides: Partial<Parameters<typeof resolveTrailingActionVisibility>[0]> = {}) {
  return resolveTrailingActionVisibility({
    workspace,
    trailing: "diff",
    hasArchiveAction: true,
    isHovered: false,
    isTouchPlatform: false,
    showShortcut: false,
    ...overrides,
  });
}

describe("resolveTrailingActionVisibility", () => {
  it("shows the kebab on hover in its own column, next to the trailing content", () => {
    expect(resolve()).toMatchObject({ showKebab: false, showTrailing: true });
    expect(resolve({ isHovered: true })).toMatchObject({
      showKebab: true,
      showQuickActions: false,
      // The kebab no longer covers the diff, so there is nothing to fade out from under it.
      showScrim: false,
      showTrailing: true,
    });
  });

  it("holds the actions column on every row with actions, hovered or not", () => {
    // A column that only appeared on hover would reflow the title every time it did.
    expect(resolve().showActionsColumn).toBe(true);
    expect(resolve({ isHovered: true }).showActionsColumn).toBe(true);
    expect(resolve({ isHovered: true, quickActionsModifierDown: true }).showActionsColumn).toBe(
      true,
    );
    expect(resolve({ hasArchiveAction: false, isHovered: true }).showActionsColumn).toBe(false);
  });

  it("expands the hovered row into the quick action rail while Alt is held", () => {
    expect(resolve({ isHovered: true, quickActionsModifierDown: true })).toMatchObject({
      showQuickActions: true,
      showKebab: false,
      showScrim: true,
    });
  });

  it("gives the rail to the selected row even when it is not hovered", () => {
    expect(resolve({ selected: true, quickActionsModifierDown: true })).toMatchObject({
      showQuickActions: true,
      showKebab: false,
      // Still drawn: the rail's scrim fades it out rather than it blinking away.
      showTrailing: true,
      showScrim: true,
    });
  });

  it("leaves rows that are neither selected nor hovered alone", () => {
    expect(resolve({ quickActionsModifierDown: true })).toMatchObject({
      showQuickActions: false,
      showKebab: false,
      showTrailing: true,
    });
  });

  it("collapses back to the kebab when Control is released", () => {
    expect(resolve({ isHovered: true, selected: true })).toMatchObject({
      showQuickActions: false,
      showKebab: true,
    });
  });

  it("shows the rail alongside the shortcut badge", () => {
    expect(
      resolve({ isHovered: true, quickActionsModifierDown: true, showShortcut: true }),
    ).toMatchObject({ showQuickActions: true, showKebab: false });
  });

  it("never shows the rail on touch or without row actions", () => {
    expect(
      resolve({ isTouchPlatform: true, selected: true, quickActionsModifierDown: true }),
    ).toMatchObject({ showQuickActions: false, showKebab: true });
    expect(
      resolve({ hasArchiveAction: false, isHovered: true, quickActionsModifierDown: true }),
    ).toMatchObject({ showQuickActions: false, showKebab: false });
  });
});
