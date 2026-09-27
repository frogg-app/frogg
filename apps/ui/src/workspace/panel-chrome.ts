import type { TextStyle, ViewStyle } from "react-native";
import type { Theme } from "@/styles/theme";
import { hexColorWithAlpha } from "@/utils/color";

// Design-direction chrome for the workspace tool panels (explorer, changes, terminal, CI, PR).
// Every helper returns the shipping values for the `current` design, so a panel that spreads
// them renders exactly as before unless a UI-refresh direction is selected.

type Variant = Theme["design"]["variant"];

function variantOf(theme: Theme): Variant {
  return theme.design.variant;
}

/** Soft accent wash used for a selected row or pill in the Inset and Soft directions. */
export function panelAccentWash(theme: Theme, alpha = 0.12): string {
  return hexColorWithAlpha(theme.colors.accent, alpha);
}

/** Bottom edge of a panel toolbar or tab track: hairline, or nothing in borderless directions. */
export function panelHeaderEdge(theme: Theme): ViewStyle {
  if (!theme.design.borderless) {
    return { borderBottomWidth: 1, borderBottomColor: theme.colors.border };
  }
  // Paper keeps a whisper of an edge in tint; Focus and Soft rely on spacing alone.
  if (variantOf(theme) === "paper") {
    return { borderBottomWidth: 1, borderBottomColor: theme.colors.borderAccent };
  }
  return { borderBottomWidth: 0, borderBottomColor: "transparent" };
}

/** Metadata text (paths, counts, ids, timestamps): mono in the Mono direction. */
export function panelMetaText(theme: Theme): TextStyle {
  return theme.design.monoMeta ? { fontFamily: theme.fontFamily.mono, letterSpacing: -0.2 } : {};
}

/**
 * Section title inside a panel (PR sections, CI groups). Paper sets it in its serif display face,
 * Soft makes it bolder; pair with `usePanelHeadingDataSet` on web.
 */
export function panelSectionTitle(theme: Theme): TextStyle {
  const design = theme.design;
  const face =
    design.headingFontFamily !== design.uiFontFamily ? { fontFamily: design.headingFontFamily } : {};
  switch (design.variant) {
    case "paper":
      return {
        ...face,
        fontSize: theme.fontSize.base,
        fontWeight: design.headingWeight,
        color: theme.colors.foreground,
        letterSpacing: design.headingLetterSpacing,
      };
    case "soft":
      return { ...face, fontWeight: theme.fontWeight.semibold, color: theme.colors.foreground };
    case "mono":
      return { ...face, color: theme.colors.foreground, letterSpacing: -0.1 };
    default:
      return face;
  }
}

interface TabChrome {
  tab: ViewStyle;
  hovered: ViewStyle;
  active: ViewStyle;
  activeUnfocused: ViewStyle;
  label: TextStyle;
  labelActive: TextStyle;
}

/**
 * Tab chip treatment per direction. `base` is the shipping chip (radius, hover, active fill)
 * so the current design passes through untouched.
 */
export function panelTabChrome(
  theme: Theme,
  base: { radius: number; hovered: string; active: string; activeUnfocused: string },
): TabChrome {
  const shipping: TabChrome = {
    tab: { borderRadius: base.radius },
    hovered: { backgroundColor: base.hovered },
    active: { backgroundColor: base.active },
    activeUnfocused: { backgroundColor: base.activeUnfocused },
    label: {},
    labelActive: { color: theme.colors.foreground },
  };
  switch (variantOf(theme)) {
    case "mono":
      // Vercel-style underline tabs: no fill, a solid rule under the active tab.
      return {
        tab: {
          borderRadius: 0,
          borderBottomWidth: 2,
          borderBottomColor: "transparent",
          borderTopWidth: 2,
          borderTopColor: "transparent",
        },
        hovered: { backgroundColor: "transparent" },
        active: { backgroundColor: "transparent", borderBottomColor: theme.colors.foreground },
        activeUnfocused: {
          backgroundColor: "transparent",
          borderBottomColor: theme.colors.foregroundExtraMuted,
        },
        label: { letterSpacing: -0.1 },
        labelActive: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
      };
    case "inset":
      return {
        ...shipping,
        tab: { borderRadius: theme.borderRadius.base },
        active: { backgroundColor: theme.colors.surface2 },
        activeUnfocused: { backgroundColor: theme.colors.surface1 },
      };
    case "paper":
      return {
        ...shipping,
        tab: { borderRadius: theme.borderRadius.lg },
        active: { backgroundColor: theme.colors.surface2 },
        labelActive: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
      };
    case "focus":
      // Near-zero chrome: the active tab is carried by text weight and colour alone.
      return {
        ...shipping,
        tab: { borderRadius: theme.borderRadius.base },
        hovered: { backgroundColor: theme.colors.surface1 },
        active: { backgroundColor: "transparent" },
        activeUnfocused: { backgroundColor: "transparent" },
        labelActive: { color: theme.colors.foreground, fontWeight: theme.fontWeight.medium },
      };
    case "soft":
      return {
        tab: { borderRadius: theme.borderRadius.full },
        hovered: { backgroundColor: theme.colors.surface2 },
        active: { backgroundColor: panelAccentWash(theme, 0.14) },
        activeUnfocused: { backgroundColor: theme.colors.surface2 },
        label: {},
        labelActive: { color: theme.colors.accent, fontWeight: theme.fontWeight.semibold },
      };
    default:
      return shipping;
  }
}

interface TreeRowChrome {
  row: ViewStyle;
  active: ViewStyle;
}

/** Row rhythm and selection for the Files and Changes trees. */
export function panelTreeRowChrome(
  theme: Theme,
  base: { paddingVertical: number; active: string },
): TreeRowChrome {
  const inset = (margin: number, radius: number, paddingVertical: number): TreeRowChrome => ({
    row: { marginHorizontal: margin, borderRadius: radius, paddingVertical },
    active: { backgroundColor: base.active },
  });
  switch (variantOf(theme)) {
    case "inset":
      return {
        row: { marginHorizontal: 4, borderRadius: theme.borderRadius.base, paddingVertical: 4 },
        active: { backgroundColor: panelAccentWash(theme, 0.1) },
      };
    case "mono":
      return {
        row: {
          paddingVertical: base.paddingVertical - 1,
          borderLeftWidth: 2,
          borderLeftColor: "transparent",
        },
        active: {
          backgroundColor: theme.colors.surface2,
          borderLeftColor: theme.colors.foreground,
        },
      };
    case "paper":
      return inset(6, theme.borderRadius.md, base.paddingVertical + 1);
    case "focus":
      return {
        row: { marginHorizontal: 6, borderRadius: theme.borderRadius.base },
        active: { backgroundColor: theme.colors.surface1 },
      };
    case "soft":
      return {
        row: { marginHorizontal: 8, borderRadius: theme.borderRadius.lg, paddingVertical: 8 },
        active: { backgroundColor: panelAccentWash(theme, 0.12) },
      };
    default:
      return { row: {}, active: { backgroundColor: base.active } };
  }
}

/** Terminal output well: flush by default, an inset rounded card in Paper and Soft. */
export function panelTerminalFrame(theme: Theme): ViewStyle {
  switch (variantOf(theme)) {
    case "paper":
      return { margin: 6, borderRadius: theme.borderRadius.lg, overflow: "hidden" };
    case "soft":
      return { margin: 8, borderRadius: theme.borderRadius.xl, overflow: "hidden" };
    default:
      return {};
  }
}

/**
 * A repeated list item in a panel (CI run, check, stream): a hairline-divided row in the lined
 * directions, a soft card in Paper and Soft, and plain spacing in Focus.
 */
export function panelListItemChrome(theme: Theme): ViewStyle {
  switch (variantOf(theme)) {
    case "paper":
      return {
        borderBottomWidth: 0,
        marginHorizontal: theme.spacing[2],
        marginTop: theme.spacing[2],
        borderRadius: theme.borderRadius.lg,
        backgroundColor: theme.colors.surface1,
      };
    case "soft":
      return {
        borderBottomWidth: 0,
        marginHorizontal: theme.spacing[2],
        marginTop: theme.spacing[2],
        borderRadius: theme.borderRadius.xl,
        backgroundColor: theme.colors.surface1,
      };
    case "focus":
      return { borderBottomWidth: 0, marginTop: theme.spacing[1] };
    default:
      return {};
  }
}

/** A bordered summary card inside a panel (release stream cards, setup callouts). */
export function panelCardChrome(theme: Theme): ViewStyle {
  switch (variantOf(theme)) {
    case "mono":
      return {
        borderRadius: theme.borderRadius.md,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      };
    case "inset":
      return { borderRadius: theme.borderRadius.md };
    case "paper":
      return { borderRadius: theme.borderRadius.xl, borderColor: "transparent" };
    case "focus":
      return { borderRadius: theme.borderRadius.lg, borderColor: "transparent" };
    case "soft":
      return {
        borderRadius: theme.borderRadius["2xl"],
        borderColor: "transparent",
        ...theme.shadow.sm,
      };
    default:
      return {};
  }
}

/**
 * A status dot of `size` px filled with `color`. Mono makes it prominent: larger, with a soft halo
 * ring in the same hue (Vercel deployment dots).
 */
export function panelStatusDot(theme: Theme, color: string, size: number): ViewStyle {
  if (variantOf(theme) !== "mono") {
    return { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
  }
  const prominent = size + 2;
  return {
    width: prominent,
    height: prominent,
    borderRadius: prominent / 2,
    backgroundColor: color,
    boxShadow: `0 0 0 3px ${hexColorWithAlpha(color, 0.22)}`,
  };
}

/** A key or small control on a panel surface (terminal key row, retry buttons). */
export function panelKeyChrome(theme: Theme, baseRadius: number): ViewStyle {
  if (variantOf(theme) === "current") return {};
  return theme.design.borderless
    ? { borderRadius: theme.design.controlRadius, borderColor: "transparent" }
    : { borderRadius: Math.min(theme.design.controlRadius, baseRadius) };
}
