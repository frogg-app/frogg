import type { DesignLayout } from "../slots";
import { MonoTopBar } from "./top-bar";

// Layout regions the mono direction replaces. Owned by the mono direction; see ../slots.ts.
// Vercel's dashboard: a top bar that carries navigation (breadcrumb selectors and tabs).
export const monoLayout: DesignLayout = {
  topBar: MonoTopBar,
};
