import type { MobilePanelView } from "@/stores/panel-store";

/**
 * What a hardware Back press should do on a compact layout.
 *
 * Back walks the app right-to-left — right sidebar to conversation, conversation
 * to the session list — and only leaves the app from the leftmost column. Routes
 * pushed on top of the workspace (settings, an opened attachment, an agent
 * detail) pop back to whatever opened them before any panel rule applies.
 */
export type MobileBackAction =
  | { kind: "consumed" }
  | { kind: "show-agent" }
  | { kind: "show-agent-list" }
  | { kind: "pop-route" }
  | { kind: "exit" };

export interface MobileBackInput {
  /** The mobile column currently on screen. */
  activePanel: MobilePanelView;
  /** Whether the router has an entry to pop back to. */
  canPopRoute: boolean;
  /** Whether a registered overlay already handled the press. */
  consumedByOverlay: boolean;
  /** Whether the focused route is the workspace (conversation) route. */
  isWorkspaceRoute: boolean;
}

export function resolveMobileBackAction(input: MobileBackInput): MobileBackAction {
  if (input.consumedByOverlay) {
    return { kind: "consumed" };
  }

  // Off the workspace route the columns are not on screen, so the route stack is
  // the only meaningful history: step back to whatever pushed this screen.
  if (!input.isWorkspaceRoute) {
    return input.canPopRoute ? { kind: "pop-route" } : { kind: "exit" };
  }

  if (input.activePanel === "file-explorer") {
    return { kind: "show-agent" };
  }
  if (input.activePanel === "agent") {
    return { kind: "show-agent-list" };
  }
  // The session list is the leftmost column: nothing further left to reveal, so
  // fall back to the route stack and then to leaving the app.
  return input.canPopRoute ? { kind: "pop-route" } : { kind: "exit" };
}

type MobileBackOverlayHandler = () => boolean;

const overlayHandlers: MobileBackOverlayHandler[] = [];

/**
 * Registers an overlay (lightbox, sheet, inline viewer) that should absorb Back
 * before the column rules run. The most recently registered handler wins, so a
 * stack of overlays unwinds top-down. The handler returns true when it consumed
 * the press.
 */
export function registerMobileBackOverlayHandler(handler: MobileBackOverlayHandler): () => void {
  overlayHandlers.push(handler);
  return () => {
    const index = overlayHandlers.indexOf(handler);
    if (index >= 0) {
      overlayHandlers.splice(index, 1);
    }
  };
}

export function runMobileBackOverlayHandlers(): boolean {
  for (let index = overlayHandlers.length - 1; index >= 0; index -= 1) {
    if (overlayHandlers[index]?.()) {
      return true;
    }
  }
  return false;
}

/**
 * Where the sidebar was when it sent the app somewhere else.
 *
 * Sidebar rows close the sidebar before they navigate, so by the time Back pops
 * the pushed route the columns have forgotten the press came from the sidebar and
 * the conversation is what surfaces. Recording the route the sidebar launched
 * from lets Back put the sidebar back instead.
 */
let sidebarOriginRoute: string | null = null;
/** Armed only by an actual Back press, so forward navigation never restores. */
let pendingSidebarRestoreRoute: string | null = null;

export function rememberMobileSidebarOrigin(pathname: string): void {
  sidebarOriginRoute = pathname;
  pendingSidebarRestoreRoute = null;
}

export function armMobileSidebarRestore(): void {
  pendingSidebarRestoreRoute = sidebarOriginRoute;
}

/** True once, when Back has landed back on the route the sidebar navigated from. */
export function takeMobileSidebarRestore(pathname: string): boolean {
  if (pendingSidebarRestoreRoute === null || pendingSidebarRestoreRoute !== pathname) {
    return false;
  }
  pendingSidebarRestoreRoute = null;
  sidebarOriginRoute = null;
  return true;
}

export function clearMobileSidebarOrigin(): void {
  sidebarOriginRoute = null;
  pendingSidebarRestoreRoute = null;
}
