import type { DesignLayout } from "../slots";
import { FocusSidebar } from "./focus-sidebar";

// Layout regions the focus direction replaces. Owned by the focus direction; see ../slots.ts.
export const focusLayout: DesignLayout = {
  sidebar: FocusSidebar,
};
