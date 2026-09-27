import type { DesignLayout } from "../slots";
import { SoftConversationTop } from "./soft-conversation-top";
import { SoftHome } from "./soft-home";
import { SoftMobileNav } from "./soft-mobile-nav";
import { SoftSidebar } from "./soft-sidebar";

// Layout regions the soft direction replaces. Owned by the soft direction; see ../slots.ts.
// Reference products: Perplexity, ChatGPT, Notion and Luma on iOS.
export const softLayout: DesignLayout = {
  sidebar: SoftSidebar,
  home: SoftHome,
  mobileNav: SoftMobileNav,
  conversationTop: SoftConversationTop,
};
