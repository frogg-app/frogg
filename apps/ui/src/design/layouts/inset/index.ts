import type { DesignLayout } from "../slots";
import { InsetAside } from "./inset-aside";
import { InsetHome } from "./inset-home";
import { InsetSidebar } from "./inset-sidebar";

// Layout regions the inset direction replaces. Owned by the inset direction; see ../slots.ts.
// Modelled on Linear: a switcher-and-views sidebar, a status-grouped list home, and a
// properties rail beside a workspace.
export const insetLayout: DesignLayout = {
  sidebar: InsetSidebar,
  home: InsetHome,
  aside: InsetAside,
};
