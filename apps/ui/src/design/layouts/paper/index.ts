import type { DesignLayout } from "../slots";
import { PaperConversationTop } from "./paper-conversation-top";
import { PaperHome } from "./paper-home";
import { PaperSidebar } from "./paper-sidebar";

// Layout regions the paper direction replaces. Owned by the paper direction; see ../slots.ts.
export const paperLayout: DesignLayout = {
  chrome: { ownsSidebarToggle: true, hidesWorkspaceTitle: true },
  sidebar: PaperSidebar,
  home: PaperHome,
  conversationTop: PaperConversationTop,
};
