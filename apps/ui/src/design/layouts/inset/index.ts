import type { DesignLayout } from "../slots";
import { InsetSidebar } from "./inset-sidebar";

// Layout regions the inset direction replaces. Owned by the inset direction; see ../slots.ts.
// Modelled on Linear: a switcher-and-views sidebar, a status-grouped list home, and a
// properties rail beside a workspace.
export const insetLayout: DesignLayout = {
  sidebar: InsetSidebar,
};
