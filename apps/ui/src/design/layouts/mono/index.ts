import type { DesignLayout } from "../slots";
import { MonoHome } from "./home";
import { MonoTopBar } from "./top-bar";

// Layout regions the mono direction replaces. Owned by the mono direction; see ../slots.ts.
// Vercel's dashboard: a top bar that carries navigation (breadcrumb selectors and tabs) and a
// deployments-style chats table as home.
export const monoLayout: DesignLayout = {
  topBar: MonoTopBar,
  home: MonoHome,
};
