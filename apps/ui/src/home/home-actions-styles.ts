import { StyleSheet } from "react-native-unistyles";
import { themeOf } from "@/styles/design-theme";
import { designHeading } from "@/styles/settings-treatment";
import type { TextFragment, ViewFragment } from "@/styles/style-fragment";
import type { Theme } from "@/styles/theme";

// Every direction-dependent value is computed from the REAL theme via `themeOf(rt.themeName)`,
// referenced inside each style value, so a live direction switch on web recomputes it.

// ---------------------------------------------------------------------------------------------
// Tiles: current (unchanged), Paper (calm tinted cards, serif titles), Soft (big rounded, raised).

function tileWidth(theme: Theme): number {
  return theme.design.variant === "soft" ? 236 : 220;
}

function tileGap(theme: Theme): number {
  return theme.design.variant === "soft" ? theme.spacing[4] : theme.spacing[3];
}

function tilesFragment(theme: Theme): ViewFragment {
  return { maxWidth: tileWidth(theme) * 2 + tileGap(theme), gap: tileGap(theme) };
}

function tileFragment(theme: Theme): ViewFragment {
  const c = theme.colors;
  switch (theme.design.variant) {
    case "current":
      return {};
    case "paper":
      return {
        padding: theme.spacing[6] - theme.spacing[1],
        borderWidth: 0,
        borderRadius: theme.borderRadius.xl,
        backgroundColor: c.surface1,
        gap: theme.spacing[4],
      };
    case "soft":
      return {
        padding: theme.spacing[6] - theme.spacing[1],
        borderWidth: 0,
        borderRadius: theme.borderRadius["2xl"],
        backgroundColor: c.surface1,
        gap: theme.spacing[4],
        ...theme.shadow.sm,
      };
    default:
      return { padding: theme.spacing[6] - theme.spacing[1] };
  }
}

function tileHoverFragment(theme: Theme): ViewFragment {
  if (theme.design.variant === "soft") return { ...theme.shadow.md };
  return {};
}

function tileTitleFragment(theme: Theme): TextFragment {
  switch (theme.design.variant) {
    case "current":
      return designHeading(theme);
    case "paper":
      return { ...designHeading(theme), fontSize: 18, lineHeight: 24 };
    case "soft":
      return { ...designHeading(theme), fontSize: theme.fontSize.lg, fontWeight: "700" };
    default:
      return { ...designHeading(theme), fontWeight: "500" };
  }
}

const WELL = { width: 44, height: 44, alignItems: "center", justifyContent: "center" } as const;

function iconWellFragment(theme: Theme, accent: boolean): ViewFragment {
  if (theme.design.variant !== "soft") return {};
  return {
    ...WELL,
    borderRadius: theme.borderRadius.full,
    backgroundColor: accent ? theme.colors.accent : theme.colors.surface3,
  };
}

function tilesMarginTop(theme: Theme, wide: boolean): number {
  if (theme.design.variant === "current") return wide ? theme.spacing[12] : theme.spacing[6];
  return theme.spacing[8];
}

export const tileStyles = StyleSheet.create((theme, rt) => ({
  tiles: {
    marginTop: {
      xs: tilesMarginTop(themeOf(rt.themeName), false),
      md: tilesMarginTop(themeOf(rt.themeName), true),
    },
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  tilesDesign: {
    ...tilesFragment(themeOf(rt.themeName)),
  },
  tile: {
    width: { xs: "100%", md: tileWidth(themeOf(rt.themeName)) },
    minHeight: { xs: 0, md: themeOf(rt.themeName).design.variant === "soft" ? 164 : 132 },
  },
  tileBase: {
    padding: theme.spacing[4],
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.xl,
    gap: theme.spacing[3],
  },
  tileDesign: {
    ...tileFragment(themeOf(rt.themeName)),
  },
  tileHovered: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderAccent,
    ...tileHoverFragment(themeOf(rt.themeName)),
  },
  pressed: {
    opacity: 0.85,
  },
  iconWell: {
    ...iconWellFragment(themeOf(rt.themeName), false),
  },
  iconWellAccent: {
    ...iconWellFragment(themeOf(rt.themeName), true),
  },
  text: {
    gap: theme.spacing[1],
    flexShrink: 1,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "normal",
    ...tileTitleFragment(themeOf(rt.themeName)),
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: themeOf(rt.themeName).design.variant === "current" ? 18 : 20,
  },
}));

// ---------------------------------------------------------------------------------------------
// Hero (Focus): the primary action drawn as a big composer card, with quiet chips beneath.

export const heroStyles = StyleSheet.create((theme, rt) => ({
  stack: {
    marginTop: theme.spacing[8],
    width: "100%",
    maxWidth: 680,
    gap: theme.spacing[4],
    alignItems: "center",
  },
  hero: {
    width: "100%",
    minHeight: { xs: 128, md: 148 },
    padding: theme.spacing[4],
    paddingLeft: theme.spacing[6] - theme.spacing[1],
    borderRadius: theme.borderRadius["2xl"],
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  heroShadow: {
    ...themeOf(rt.themeName).shadow.md,
  },
  heroHovered: {
    borderColor: theme.colors.borderAccent,
    ...themeOf(rt.themeName).shadow.lg,
  },
  body: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    paddingTop: theme.spacing[1],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontWeight: "500",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  submit: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: theme.spacing[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: 32,
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface1,
  },
  chipHovered: {
    backgroundColor: theme.colors.surface2,
  },
  chipText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

// ---------------------------------------------------------------------------------------------
// List: Mono (stark hairline table, mono indices) and Inset (compact rows in one small card).

function isMono(themeName: string | undefined): boolean {
  return themeOf(themeName).design.variant === "mono";
}

export const listStyles = StyleSheet.create((theme, rt) => ({
  list: {
    marginTop: isMono(rt.themeName) ? theme.spacing[8] : theme.spacing[4],
    width: "100%",
    maxWidth: isMono(rt.themeName) ? 600 : 480,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: isMono(rt.themeName) ? theme.borderRadius.md : theme.borderRadius.lg,
    backgroundColor: isMono(rt.themeName) ? theme.colors.surface0 : theme.colors.surface1,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: isMono(rt.themeName) ? theme.spacing[3] : theme.spacing[2] + theme.spacing[0.5],
    minHeight: isMono(rt.themeName) ? 60 : 34,
    paddingHorizontal: isMono(rt.themeName) ? theme.spacing[4] : theme.spacing[3],
    paddingVertical: isMono(rt.themeName) ? theme.spacing[3] : theme.spacing[1.5],
  },
  divider: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  hovered: {
    backgroundColor: isMono(rt.themeName) ? theme.colors.surface1 : theme.colors.surface2,
  },
  index: {
    display: isMono(rt.themeName) ? "flex" : "none",
    width: 22,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: themeOf(rt.themeName).design.monoFontFamily,
  },
  text: {
    flex: 1,
    minWidth: 0,
    flexDirection: isMono(rt.themeName) ? "column" : "row",
    alignItems: isMono(rt.themeName) ? "stretch" : "baseline",
    gap: isMono(rt.themeName) ? 2 : theme.spacing[2],
  },
  title: {
    flexShrink: 0,
    color: theme.colors.foreground,
    fontSize: isMono(rt.themeName) ? theme.fontSize.base : 13,
    fontWeight: "500",
  },
  description: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: isMono(rt.themeName) ? theme.fontSize.sm : 13,
  },
  primary: {
    width: 24,
    height: 24,
    borderRadius: isMono(rt.themeName) ? theme.borderRadius.sm : theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: isMono(rt.themeName) ? theme.colors.primary : theme.colors.accent,
  },
}));
