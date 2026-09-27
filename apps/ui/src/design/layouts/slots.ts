import type { ComponentType } from "react";

// Regions a design direction may replace wholesale. Each direction registers only the regions
// its reference product lays out differently; anything it leaves out renders the shipping UI.
// Slot components pick their own data from the existing stores and hooks.
export interface DesignSlotProps {
  /** The app's left sidebar (desktop column and mobile drawer content). */
  sidebar: { active: boolean };
  /** A full-width bar above the sidebar and content, e.g. a top navigation. */
  topBar: Record<string, never>;
  /** The host home / open-project screen. */
  home: Record<string, never>;
  /** A right-hand column beside the main content on desktop, e.g. a properties panel. */
  aside: Record<string, never>;
  /** A bottom tab bar on compact (mobile) layouts. */
  mobileNav: Record<string, never>;
  /** A strip above an agent's conversation, e.g. agent status cards. */
  conversationTop: { serverId: string; agentId: string };
}

export type DesignSlotName = keyof DesignSlotProps;

/** Shipping chrome a direction takes over, so it isn't drawn twice. Desktop only. */
export interface DesignChrome {
  /** The direction's sidebar has its own collapse control: hide the header's sidebar toggle
   * while the sidebar is open (it still shows when collapsed, to reopen it). */
  ownsSidebarToggle?: boolean;
  /** The direction's `conversationTop` shows the chat title: drop the workspace header's. */
  hidesWorkspaceTitle?: boolean;
}

export type DesignLayout = {
  [Name in DesignSlotName]?: ComponentType<DesignSlotProps[Name]>;
} & { chrome?: DesignChrome };
