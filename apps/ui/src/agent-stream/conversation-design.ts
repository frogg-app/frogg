import type { TextStyle, ViewStyle } from "react-native";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import type { themeOf } from "@/styles/design-theme";

// Shape of the agent conversation (timeline, tool rows, composer) per design direction.
//
// Every helper takes the REAL theme, `themeOf(rt.themeName)`: on web the `theme` argument of
// `StyleSheet.create` holds CSS-variable strings and frozen numbers, so it cannot be branched on.
// Reference `rt.themeName` inside each style value so the style recomputes on a design switch:
//
//   bubble: { ...base, ...userMessageSurfaceStyle(themeOf(rt.themeName)) },
//
// Helpers return overrides only; the `current` design gets `{}` (or the caller's value), so the
// shipping look is untouched.
type RealTheme = ReturnType<typeof themeOf>;

/** Width of the centred reading column shared by the stream, turn footer and composer. */
export function readingColumnMaxWidth(t: RealTheme): number {
  return t.design.contentMaxWidth ?? MAX_CONTENT_WIDTH;
}

/** Radius for a composer or toolbar control; `current` keeps the caller's shipping radius. */
export function controlRadius(t: RealTheme, currentRadius: number): number {
  return t.design.variant === "current" ? currentRadius : t.design.controlRadius;
}

/** Face and size for metadata (timestamps, elapsed time) next to messages. */
export function metaTextStyle(t: RealTheme): TextStyle {
  return t.design.monoMeta ? { fontFamily: t.fontFamily.mono, fontSize: 12 } : {};
}

// ---------------------------------------------------------------------------
// User message
// ---------------------------------------------------------------------------

export function userMessageRowStyle(t: RealTheme): ViewStyle {
  return t.design.userMessage === "bubble" ? {} : { justifyContent: "flex-start" };
}

export function userMessageContentStyle(t: RealTheme): ViewStyle {
  return t.design.userMessage === "bubble" ? {} : { alignItems: "stretch", flex: 1, minWidth: 0 };
}

export function userMessageSurfaceStyle(t: RealTheme): ViewStyle {
  switch (t.design.userMessage) {
    case "plain":
      // Mono: no container. A stark rule in the gutter marks the speaker.
      return {
        backgroundColor: "transparent",
        borderRadius: 0,
        borderTopRightRadius: 0,
        borderLeftWidth: 2,
        borderLeftColor: t.colors.foreground,
        paddingHorizontal: 0,
        paddingLeft: t.spacing[3],
        paddingVertical: t.spacing[1],
      };
    case "card":
      // Focus: a quiet full-width bordered card.
      return {
        backgroundColor: t.colors.surface1,
        borderWidth: t.borderWidth[1],
        borderColor: t.colors.border,
        borderRadius: t.borderRadius.lg,
        borderTopRightRadius: t.borderRadius.lg,
        paddingHorizontal: t.spacing[4],
        paddingVertical: t.spacing[3],
      };
    default:
      return bubbleShape(t);
  }
}

function bubbleShape(t: RealTheme): ViewStyle {
  switch (t.design.variant) {
    case "paper":
      return {
        backgroundColor: t.colors.surface3,
        borderRadius: t.borderRadius.xl,
        borderTopRightRadius: t.borderRadius.xl,
        paddingVertical: t.spacing[3],
      };
    case "soft":
      return {
        backgroundColor: t.colors.surface2,
        borderRadius: t.borderRadius["2xl"],
        borderTopRightRadius: t.borderRadius["2xl"],
        paddingHorizontal: t.spacing[4] + 2,
        paddingVertical: t.spacing[3],
      };
    case "inset":
      return {
        backgroundColor: t.colors.surface2,
        borderWidth: t.borderWidth[1],
        borderColor: t.colors.border,
        borderRadius: t.borderRadius.lg,
        borderTopRightRadius: t.borderRadius.lg,
        paddingHorizontal: t.spacing[3],
        paddingVertical: t.spacing[2],
      };
    default:
      return {};
  }
}

export function userMessageTextStyle(t: RealTheme): TextStyle {
  if (t.design.userMessage === "plain") {
    return { fontWeight: t.fontWeight.medium };
  }
  if (t.design.variant === "inset") {
    return { fontSize: t.fontSize.base };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Tool-call and thinking rows
// ---------------------------------------------------------------------------

export interface ToolRowDesign {
  container: ViewStyle;
  pressable: ViewStyle;
  pressableExpanded: ViewStyle;
  labelRow: ViewStyle;
  label: TextStyle;
}

const NO_TOOL_ROW_DESIGN: ToolRowDesign = {
  container: {},
  pressable: {},
  pressableExpanded: {},
  labelRow: {},
  label: {},
};

export function toolRowDesign(t: RealTheme): ToolRowDesign {
  switch (t.design.variant) {
    case "mono":
      // Dashboard rows: hairline box, mono label.
      return {
        container: { marginHorizontal: 0 },
        pressable: {
          borderColor: t.colors.border,
          borderRadius: t.borderRadius.base,
          paddingVertical: t.spacing[1] + 1,
        },
        pressableExpanded: {},
        labelRow: {},
        label: { fontFamily: t.fontFamily.mono, fontSize: t.fontSize.sm },
      };
    case "focus":
      // Quiet collapsed rows: smaller and lighter; chrome only on hover.
      return {
        ...NO_TOOL_ROW_DESIGN,
        pressable: { paddingVertical: t.spacing[0.5] },
        label: { fontSize: 13 },
      };
    case "soft":
      // Rounded chips that hug their label; they widen into a card when expanded.
      return {
        container: { marginHorizontal: 0, alignItems: "flex-start" },
        pressable: {
          maxWidth: "100%",
          backgroundColor: t.colors.surface2,
          borderRadius: t.design.controlRadius,
          paddingHorizontal: t.spacing[3],
          paddingVertical: t.spacing[1] + 1,
        },
        pressableExpanded: { alignSelf: "stretch", borderRadius: t.borderRadius.xl },
        labelRow: { flexGrow: 0, flexShrink: 1, flexBasis: "auto" },
        label: {},
      };
    case "inset":
      return {
        ...NO_TOOL_ROW_DESIGN,
        pressable: { paddingVertical: t.spacing[0.5], borderRadius: t.borderRadius.md },
        label: { fontSize: 13 },
      };
    default:
      return NO_TOOL_ROW_DESIGN;
  }
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export function composerSurfaceStyle(t: RealTheme): ViewStyle {
  switch (t.design.composer) {
    case "floating":
      return {
        backgroundColor: t.colors.popover,
        borderColor: t.colors.borderAccent,
        borderRadius: t.borderRadius.xl,
        ...t.shadow.md,
      };
    case "pill":
      return {
        backgroundColor: t.colors.popover,
        borderColor: t.colors.borderAccent,
        borderRadius: 28,
        paddingHorizontal: t.spacing[4] + 2,
        ...t.shadow.md,
      };
    default:
      if (t.design.variant === "mono") {
        return {
          backgroundColor: t.colors.surface0,
          borderColor: t.colors.border,
          borderRadius: t.borderRadius.lg,
        };
      }
      if (t.design.variant === "inset") {
        return { borderColor: t.colors.border, borderRadius: t.borderRadius.xl };
      }
      return {};
  }
}

/** Composer toolbar pills (model, provider, mode). */
export function composerControlStyle(t: RealTheme): ViewStyle {
  switch (t.design.variant) {
    case "current":
      return {};
    case "mono":
      return {
        borderWidth: t.borderWidth[1],
        borderColor: t.colors.border,
        borderRadius: t.design.controlRadius,
      };
    case "soft":
      return { backgroundColor: t.colors.surface2, borderRadius: t.design.controlRadius };
    default:
      return { borderRadius: t.design.controlRadius };
  }
}

export function composerControlTextStyle(t: RealTheme): TextStyle {
  return t.design.monoMeta ? { fontFamily: t.fontFamily.mono, fontSize: t.fontSize.sm } : {};
}
