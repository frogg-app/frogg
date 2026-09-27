import type { TextStyle, ViewStyle } from "react-native";
import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import type { Theme } from "@/styles/theme";

// Shape of the agent conversation (timeline, tool rows, composer) per design direction.
// Every helper returns the shipping style for the `current` design, so callers can spread the
// result unconditionally. Call them inside `StyleSheet.create((theme) => ...)` only.

/** Width of the centred reading column shared by the stream, turn footer and composer. */
export function readingColumnMaxWidth(theme: Theme): number {
  return theme.design.contentMaxWidth ?? MAX_CONTENT_WIDTH;
}

/** Radius for a composer or toolbar control; `current` keeps the caller's shipping radius. */
export function controlRadius(theme: Theme, currentRadius: number): number {
  return theme.design.variant === "current" ? currentRadius : theme.design.controlRadius;
}

/** Face and size for metadata (timestamps, elapsed time) next to messages. */
export function metaTextStyle(theme: Theme): TextStyle {
  return theme.design.monoMeta ? { fontFamily: theme.fontFamily.mono, fontSize: 12 } : {};
}

// ---------------------------------------------------------------------------
// User message
// ---------------------------------------------------------------------------

export function userMessageRowStyle(theme: Theme): ViewStyle {
  return {
    flexDirection: "row",
    justifyContent: theme.design.userMessage === "bubble" ? "flex-end" : "flex-start",
  };
}

export function userMessageContentStyle(theme: Theme): ViewStyle {
  if (theme.design.userMessage === "bubble") {
    return { alignItems: "flex-end", maxWidth: "100%" };
  }
  return { alignItems: "stretch", flex: 1, minWidth: 0, maxWidth: "100%" };
}

export function userMessageSurfaceStyle(theme: Theme): ViewStyle {
  const base: ViewStyle = { minWidth: 0, flexShrink: 1 };
  switch (theme.design.userMessage) {
    case "plain":
      // Mono: no container. A stark rule in the gutter marks the speaker.
      return {
        ...base,
        borderLeftWidth: 2,
        borderLeftColor: theme.colors.foreground,
        paddingLeft: theme.spacing[3],
        paddingVertical: theme.spacing[1],
      };
    case "card":
      // Focus: a quiet full-width bordered card.
      return {
        ...base,
        backgroundColor: theme.colors.surface1,
        borderWidth: theme.borderWidth[1],
        borderColor: theme.colors.borderAccent,
        borderRadius: theme.borderRadius.lg,
        paddingHorizontal: theme.spacing[4],
        paddingVertical: theme.spacing[3],
      };
    case "bubble":
      return { ...base, ...bubbleShape(theme) };
  }
}

function bubbleShape(theme: Theme): ViewStyle {
  switch (theme.design.variant) {
    case "paper":
      return {
        backgroundColor: theme.colors.surface3,
        borderRadius: theme.borderRadius.xl,
        paddingHorizontal: theme.spacing[4],
        paddingVertical: theme.spacing[3],
      };
    case "soft":
      return {
        backgroundColor: theme.colors.surface2,
        borderRadius: theme.borderRadius["2xl"],
        paddingHorizontal: theme.spacing[4] + 2,
        paddingVertical: theme.spacing[3],
      };
    case "inset":
      return {
        backgroundColor: theme.colors.surface2,
        borderWidth: theme.borderWidth[1],
        borderColor: theme.colors.border,
        borderRadius: theme.borderRadius.lg,
        paddingHorizontal: theme.spacing[3],
        paddingVertical: theme.spacing[2],
      };
    default:
      return {
        backgroundColor: theme.colors.surface3,
        borderRadius: theme.borderRadius["2xl"],
        borderTopRightRadius: theme.borderRadius.sm,
        paddingHorizontal: theme.spacing[4],
        paddingVertical: theme.spacing[4],
      };
  }
}

export function userMessageTextStyle(theme: Theme): TextStyle {
  if (theme.design.userMessage === "plain") {
    return { fontWeight: theme.fontWeight.medium };
  }
  if (theme.design.variant === "inset") {
    return { fontSize: theme.fontSize.base };
  }
  return {};
}

// ---------------------------------------------------------------------------
// Assistant prose
// ---------------------------------------------------------------------------

/** True when assistant prose uses its own face (tag the container with DESIGN_FONT_DATASET). */
export function hasContentFont(theme: Theme): boolean {
  return theme.design.contentFontFamily !== null;
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

export function toolRowDesign(theme: Theme): ToolRowDesign {
  switch (theme.design.variant) {
    case "mono":
      // Dashboard rows: hairline box, mono label.
      return {
        container: { marginHorizontal: 0 },
        pressable: {
          borderColor: theme.colors.border,
          borderRadius: theme.borderRadius.base,
          paddingVertical: theme.spacing[1] + 1,
        },
        pressableExpanded: {},
        labelRow: {},
        label: { fontFamily: theme.fontFamily.mono, fontSize: theme.fontSize.sm },
      };
    case "focus":
      // Quiet collapsed rows: smaller, lighter, no chrome until hovered.
      return {
        ...NO_TOOL_ROW_DESIGN,
        pressable: { paddingVertical: theme.spacing[0.5] },
        label: { fontSize: theme.fontSize.sm },
      };
    case "soft":
      // Rounded chips that hug their label; they widen into a card when expanded.
      return {
        container: { marginHorizontal: 0, alignItems: "flex-start" },
        pressable: {
          maxWidth: "100%",
          backgroundColor: theme.colors.surface2,
          borderRadius: theme.design.controlRadius,
          paddingHorizontal: theme.spacing[3],
          paddingVertical: theme.spacing[1] + 1,
        },
        pressableExpanded: {
          alignSelf: "stretch",
          borderRadius: theme.borderRadius.xl,
        },
        labelRow: { flexGrow: 0, flexShrink: 1, flexBasis: "auto" },
        label: {},
      };
    case "inset":
      return {
        ...NO_TOOL_ROW_DESIGN,
        pressable: { paddingVertical: theme.spacing[0.5] },
        label: { fontSize: 13 },
      };
    default:
      return NO_TOOL_ROW_DESIGN;
  }
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

export function composerSurfaceStyle(theme: Theme): ViewStyle {
  switch (theme.design.composer) {
    case "floating":
      return {
        backgroundColor: theme.colors.popover,
        borderColor: theme.colors.borderAccent,
        borderRadius: theme.borderRadius.xl,
        ...theme.shadow.md,
      };
    case "pill":
      return {
        backgroundColor: theme.colors.popover,
        borderColor: theme.colors.borderAccent,
        borderRadius: 28,
        paddingHorizontal: theme.spacing[4] + 2,
        ...theme.shadow.md,
      };
    case "box":
      if (theme.design.variant === "mono") {
        return { backgroundColor: theme.colors.surface0, borderColor: theme.colors.border };
      }
      if (theme.design.variant === "inset") {
        return { borderColor: theme.colors.border, borderRadius: theme.borderRadius.xl };
      }
      return {};
  }
}

/** Composer toolbar pills (model, provider, mode). */
export function composerControlStyle(theme: Theme): ViewStyle {
  switch (theme.design.variant) {
    case "mono":
      return {
        borderWidth: theme.borderWidth[1],
        borderColor: theme.colors.border,
        borderRadius: theme.design.controlRadius,
      };
    case "soft":
      return { backgroundColor: theme.colors.surface2, borderRadius: theme.design.controlRadius };
    case "current":
      return {};
    default:
      return { borderRadius: theme.design.controlRadius };
  }
}

export function composerControlTextStyle(theme: Theme): TextStyle {
  if (theme.design.monoMeta) {
    return { fontFamily: theme.fontFamily.mono, fontSize: theme.fontSize.sm };
  }
  return {};
}
