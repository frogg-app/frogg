import { create } from "zustand";
import type { SidebarShortcutWorkspaceTarget } from "@/utils/sidebar-shortcuts";

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
   * A bare Control is being held.
   *
   * Drives the sidebar row's quick action rail. Tracked independently of the badge modifier
   * because the two are allowed to be up at once: on desktop non-Mac Control is also the
   * workspace-jump modifier, and holding it shows the number badges *and* the rail, with the
   * badge sitting to the left of the rail rather than being replaced by it.
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

/**
 * The badges follow the modifier with no delay. They used to wait 150ms, which meant the
 * quick action rail — which appears at once — had already drawn against the row's right edge
 * before the badge arrived and shoved it left. The badge fades in on mount instead, so the
 * reveal is soft without anything moving after the fact.
 */
function updateBadgeVisibility(
  set: (partial: Partial<KeyboardShortcutsState>) => void,
  get: () => KeyboardShortcutsState,
) {
  const { altDown, cmdOrCtrlDown } = get();
  set({ showShortcutBadges: altDown || cmdOrCtrlDown });
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
    set({ altDown: down });
    updateBadgeVisibility(set, get);
  },
  setCmdOrCtrlDown: (down) => {
    set({ cmdOrCtrlDown: down });
    updateBadgeVisibility(set, get);
  },
  setQuickActionsModifierDown: (down) => {
    set({ quickActionsModifierDown: down });
  },
  setSidebarShortcutWorkspaceTargets: (targets) =>
    set({ sidebarShortcutWorkspaceTargets: targets }),
  resetModifiers: () => {
    // Blur and visibility loss take every held modifier with them. A key released while the
    // window is not focused never reaches the keyup listener, so without this a held Control
    // would leave the rail open forever.
    set({ altDown: false, cmdOrCtrlDown: false, quickActionsModifierDown: false });
    updateBadgeVisibility(set, get);
  },
}));
