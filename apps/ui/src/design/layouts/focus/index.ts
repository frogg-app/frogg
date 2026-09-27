import type { DesignLayout } from "../slots";
import { FocusAgentCards } from "./focus-agent-cards";
import { FocusHome } from "./focus-home";
import { FocusSidebar } from "./focus-sidebar";

// Layout regions the focus direction replaces. Owned by the focus direction; see ../slots.ts.
export const focusLayout: DesignLayout = {
  chrome: { ownsSidebarToggle: true },
  sidebar: FocusSidebar,
  home: FocusHome,
  conversationTop: FocusAgentCards,
};
