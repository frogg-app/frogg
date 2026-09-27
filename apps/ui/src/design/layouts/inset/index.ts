import type { DesignLayout } from "../slots";
import { InsetAside } from "./inset-aside";
import { InsetConversationTop } from "./inset-conversation-top";
import { InsetHome } from "./inset-home";
import { InsetSidebar } from "./inset-sidebar";

// Layout regions the inset direction replaces. Owned by the inset direction; see ../slots.ts.
// Modelled on Linear: a switcher-and-views sidebar, a status-grouped list home, and a
// properties rail beside a workspace (property pills above the conversation on phones).
export const insetLayout: DesignLayout = {
  sidebar: InsetSidebar,
  home: InsetHome,
  aside: InsetAside,
  // Compact only: Linear mobile's property pills, standing in for the rail phones do not get.
  conversationTop: InsetConversationTop,
};
