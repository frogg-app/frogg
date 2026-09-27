import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { mixColor } from "@/styles/color-mix";
import { themeOf } from "@/styles/design-theme";
import type { ViewFragment } from "@/styles/style-fragment";
import type { Theme } from "@/styles/theme";

/**
 * The desktop app frame for the design direction's `frame` token.
 *
 * - flat: sidebar and content share one plane (the shipping layout; these styles are no-ops).
 * - inset: the sidebar sits on a sidebar-coloured frame and the content is a rounded card inset
 *   from the frame's top, right and bottom edges.
 * - floating: sidebar and content are separate rounded, raised cards with a gap between them on
 *   a frame background.
 *
 * Compact layouts always render flat; the mobile shell has its own drawer and header treatment.
 *
 * On web the stylesheet `theme` is CSS variables, so the frame kind, radii and shadows come from
 * the registered theme for `rt.themeName` (referenced inside each style value so a live design
 * switch recomputes them). Plain colours stay on the stylesheet `theme` so appearance overrides
 * applied through `UnistylesRuntime.updateTheme` still reach the frame.
 */
export const APP_FRAME_GAP = 8;

type RealTheme = ReturnType<typeof themeOf>;

export function resolveAppFrameBackground(theme: Theme, real: RealTheme): string {
  switch (real.design.frame) {
    case "flat":
      return theme.colors.surface0;
    case "inset":
      return theme.colors.surfaceSidebar;
    case "floating":
      // A plane behind both cards, a step darker than the sidebar card in either scheme.
      return real.colorScheme === "dark"
        ? mixColor(real.colors.surfaceSidebar, "#000000", 0.45)
        : mixColor(real.colors.surfaceSidebar, real.colors.foreground, 0.06);
  }
}

function rowStyle(theme: Theme, real: RealTheme): ViewFragment {
  const frame = real.design.frame;
  if (frame === "flat") return { flex: 1, flexDirection: "row" };
  return {
    flex: 1,
    flexDirection: "row",
    backgroundColor: resolveAppFrameBackground(theme, real),
    paddingTop: APP_FRAME_GAP,
    paddingBottom: APP_FRAME_GAP,
    paddingRight: APP_FRAME_GAP,
    paddingLeft: frame === "floating" ? APP_FRAME_GAP : 0,
    gap: frame === "floating" ? APP_FRAME_GAP : 0,
  };
}

function contentStyle(theme: Theme, real: RealTheme): ViewFragment {
  const frame = real.design.frame;
  if (frame === "flat") return { flex: 1 };
  const card: ViewFragment = {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: theme.colors.surface0,
  };
  if (frame === "inset") {
    return {
      ...card,
      borderRadius: real.borderRadius.xl,
      borderWidth: 1,
      borderColor: theme.colors.border,
    };
  }
  return { ...card, borderRadius: real.borderRadius["2xl"], ...real.shadow.md };
}

/**
 * How far the frame moves the sidebar's top-left from the window's: chrome drawn in window
 * coordinates over the sidebar (the window-owned sidebar toggle) shifts by this to stay on the
 * sidebar's brand row.
 */
export function appFrameSidebarOffset(real: RealTheme): { top: number; left: number } {
  switch (real.design.frame) {
    case "flat":
      return { top: 0, left: 0 };
    case "inset":
      return { top: APP_FRAME_GAP, left: 0 };
    case "floating":
      return { top: APP_FRAME_GAP, left: APP_FRAME_GAP };
  }
}

/** The window surface behind the frame: the frame colour when framed. */
export function appSurfaceStyle(theme: Theme, real: RealTheme): ViewFragment {
  return { flex: 1, backgroundColor: resolveAppFrameBackground(theme, real) };
}

export function AppFrameRow({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <View style={enabled ? frameStyles.row : frameStyles.rowFlat}>{children}</View>;
}

export function AppFrameContent({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <View style={enabled ? frameStyles.content : frameStyles.contentFlat}>{children}</View>;
}

// Each value is an object literal: the Unistyles babel plugin records `rt.themeName` as a
// dependency only there, and a bare helper call would keep the direction it first rendered with.
const frameStyles = StyleSheet.create((theme, rt) => ({
  row: { ...rowStyle(theme, themeOf(rt.themeName)) },
  rowFlat: { flex: 1, flexDirection: "row" },
  content: { ...contentStyle(theme, themeOf(rt.themeName)) },
  contentFlat: { flex: 1 },
}));
