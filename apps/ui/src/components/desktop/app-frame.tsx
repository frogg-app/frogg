import type { ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { mixColor } from "@/styles/color-mix";
import type { Theme } from "@/styles/theme";

/**
 * The desktop app frame for `theme.design.frame`.
 *
 * - flat: sidebar and content share one plane (the shipping layout; these styles are no-ops).
 * - inset: the sidebar sits on a sidebar-coloured frame and the content is a rounded card inset
 *   from the frame's top, right and bottom edges.
 * - floating: sidebar and content are separate rounded, raised cards with a gap between them on
 *   a frame background.
 *
 * Compact layouts always render flat; the mobile shell has its own drawer and header treatment.
 */
export const APP_FRAME_GAP = 8;

export function resolveAppFrameBackground(theme: Theme): string {
  switch (theme.design.frame) {
    case "flat":
      return theme.colors.surface0;
    case "inset":
      return theme.colors.surfaceSidebar;
    case "floating":
      // A plane behind both cards, a step darker than the sidebar card in either scheme.
      return theme.colorScheme === "dark"
        ? mixColor(theme.colors.surfaceSidebar, "#000000", 0.45)
        : mixColor(theme.colors.surfaceSidebar, theme.colors.foreground, 0.06);
  }
}

export function AppFrameRow({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <View style={frameStyles.row(enabled)}>{children}</View>;
}

export function AppFrameContent({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return <View style={frameStyles.content(enabled)}>{children}</View>;
}

const frameStyles = StyleSheet.create((theme) => ({
  row: (enabled: boolean) => {
    const frame = enabled ? theme.design.frame : "flat";
    return {
      flex: 1,
      flexDirection: "row" as const,
      backgroundColor: frame === "flat" ? undefined : resolveAppFrameBackground(theme),
      paddingTop: frame === "flat" ? 0 : APP_FRAME_GAP,
      paddingBottom: frame === "flat" ? 0 : APP_FRAME_GAP,
      paddingRight: frame === "flat" ? 0 : APP_FRAME_GAP,
      paddingLeft: frame === "floating" ? APP_FRAME_GAP : 0,
      gap: frame === "floating" ? APP_FRAME_GAP : 0,
    };
  },
  content: (enabled: boolean) => {
    const frame = enabled ? theme.design.frame : "flat";
    if (frame === "flat") return { flex: 1 };
    const card = {
      flex: 1,
      minWidth: 0,
      overflow: "hidden" as const,
      backgroundColor: theme.colors.surface0,
    };
    if (frame === "inset") {
      return {
        ...card,
        borderRadius: theme.borderRadius.xl,
        borderWidth: 1,
        borderColor: theme.colors.border,
      };
    }
    return {
      ...card,
      borderRadius: theme.borderRadius["2xl"],
      ...theme.shadow.md,
    };
  },
}));
