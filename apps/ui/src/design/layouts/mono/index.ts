import type { DesignLayout } from "../slots";
import { MonoConversationTop } from "./conversation-top";
import { MonoHome } from "./home";
import { MonoSidebar } from "./sidebar";
import { MonoTopBar } from "./top-bar";

// Layout regions the mono direction replaces. Owned by the mono direction; see ../slots.ts.
// Vercel's dashboard: a top bar that carries navigation (breadcrumb selectors and tabs) in
// place of a desktop sidebar, a deployments-style chats table as home, and a "deployment
// details" card above each conversation.
export const monoLayout: DesignLayout = {
  // No desktop sidebar: the top bar carries navigation, so the header toggle has nothing to open.
  chrome: { ownsSidebarToggle: true },
  topBar: MonoTopBar,
  sidebar: MonoSidebar,
  home: MonoHome,
  conversationTop: MonoConversationTop,
};
