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

export type DesignLayout = {
  [Name in DesignSlotName]?: ComponentType<DesignSlotProps[Name]>;
};
