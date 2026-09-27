import type { DesignLayout } from "../slots";
import { FocusHome } from "./focus-home";
import { FocusSidebar } from "./focus-sidebar";

// Layout regions the focus direction replaces. Owned by the focus direction; see ../slots.ts.
export const focusLayout: DesignLayout = {
  sidebar: FocusSidebar,
  home: FocusHome,
};
