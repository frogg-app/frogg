import { create } from "zustand";
import type { SidebarShortcutWorkspaceTarget } from "@/utils/sidebar-shortcuts";

const SHORTCUT_BADGE_DELAY_MS = 150;

export type CommandCenterScope = "files" | null;

interface KeyboardShortcutsState {
  commandCenterOpen: boolean;
  commandCenterScope: CommandCenterScope;
  shortcutsDialogOpen: boolean;
  capturingShortcut: boolean;
  altDown: boolean;
  cmdOrCtrlDown: boolean;
  showShortcutBadges: boolean;
  /**
   * A bare Alt is being held, and it is not this runtime's workspace-jump modifier.
   *
   * Drives the sidebar row's quick action rail. Deliberately separate from the badge
   * modifier: on web the jump binding is Alt+1-9, so the same physical key would mean two
   * things at once. The badge hold wins there and this stays false, which leaves the rail
   * effectively desktop-only rather than fighting the number badges for the same key.
   */
  quickActionsModifierDown: boolean;
  /** Sidebar-visible workspace targets (up to 9), in top-to-bottom visual order. */
  sidebarShortcutWorkspaceTargets: SidebarShortcutWorkspaceTarget[];

  setCommandCenterOpen: (open: boolean, scope?: CommandCenterScope) => void;
  setCommandCenterScope: (scope: CommandCenterScope) => void;
  setShortcutsDialogOpen: (open: boolean) => void;
  setCapturingShortcut: (capturing: boolean) => void;
  setAltDown: (down: boolean) => void;
  setCmdOrCtrlDown: (down: boolean) => void;
  setQuickActionsModifierDown: (down: boolean) => void;
  setSidebarShortcutWorkspaceTargets: (targets: SidebarShortcutWorkspaceTarget[]) => void;
  resetModifiers: () => void;
}

let badgeTimer: ReturnType<typeof setTimeout> | null = null;

function updateBadgeTimer(
  set: (partial: Partial<KeyboardShortcutsState>) => void,
  get: () => KeyboardShortcutsState,
) {
  const { altDown, cmdOrCtrlDown } = get();
  const modifierDown = altDown || cmdOrCtrlDown;

  if (badgeTimer) {
    clearTimeout(badgeTimer);
    badgeTimer = null;
  }

  if (modifierDown) {
    badgeTimer = setTimeout(() => {
      set({ showShortcutBadges: true });
    }, SHORTCUT_BADGE_DELAY_MS);
  } else {
    set({ showShortcutBadges: false });
  }
}

export const useKeyboardShortcutsStore = create<KeyboardShortcutsState>((set, get) => ({
  commandCenterOpen: false,
  commandCenterScope: null,
  shortcutsDialogOpen: false,
  capturingShortcut: false,
  altDown: false,
  cmdOrCtrlDown: false,
  showShortcutBadges: false,
  quickActionsModifierDown: false,
  sidebarShortcutWorkspaceTargets: [],

  setCommandCenterOpen: (open, scope = null) =>
    set({ commandCenterOpen: open, commandCenterScope: open ? scope : null }),
  setCommandCenterScope: (scope) => set({ commandCenterScope: scope }),
  setShortcutsDialogOpen: (open) => set({ shortcutsDialogOpen: open }),
  setCapturingShortcut: (capturing) => set({ capturingShortcut: capturing }),
  setAltDown: (down) => {
    // The badge hold wins: a runtime where Alt jumps between workspaces must not also open
    // the rail, or one key press would do two unrelated things.
    set(down ? { altDown: true, quickActionsModifierDown: false } : { altDown: false });
    updateBadgeTimer(set, get);
  },
  setCmdOrCtrlDown: (down) => {
    set(down ? { cmdOrCtrlDown: true, quickActionsModifierDown: false } : { cmdOrCtrlDown: false });
    updateBadgeTimer(set, get);
  },
  setQuickActionsModifierDown: (down) => {
    const { altDown, cmdOrCtrlDown } = get();
    set({ quickActionsModifierDown: down && !altDown && !cmdOrCtrlDown });
  },
  setSidebarShortcutWorkspaceTargets: (targets) =>
    set({ sidebarShortcutWorkspaceTargets: targets }),
  resetModifiers: () => {
    // Blur and visibility loss take every held modifier with them. A key released while the
    // window is not focused never reaches the keyup listener, so without this a held Alt
    // would leave the rail open forever.
    set({ altDown: false, cmdOrCtrlDown: false, quickActionsModifierDown: false });
    updateBadgeTimer(set, get);
  },
}));
