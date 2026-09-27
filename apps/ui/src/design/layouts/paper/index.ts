import type { DesignLayout } from "../slots";
import { PaperHome } from "./paper-home";
import { PaperSidebar } from "./paper-sidebar";

// Layout regions the paper direction replaces. Owned by the paper direction; see ../slots.ts.
export const paperLayout: DesignLayout = {
  sidebar: PaperSidebar,
  home: PaperHome,
};
