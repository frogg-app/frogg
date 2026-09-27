import type { StyleProp, ViewStyle } from "react-native";
import { ICON_SIZE, type Theme } from "@/styles/theme";

export type ButtonControlSize = "xs" | "sm" | "md" | "lg";
export type FieldControlSize = "sm" | "md";
export type SegmentedControlSize = "xs" | "sm" | "md";
export type ControlInteractionPhase = "rest" | "hover" | "active";

export interface ControlInteractionState {
  hovered?: boolean;
  focused?: boolean;
  pressed?: boolean;
  open?: boolean;
  active?: boolean;
  disabled?: boolean;
}

export interface ControlInteractionStyleMap {
  controlRest: StyleProp<ViewStyle>;
  controlHover: StyleProp<ViewStyle>;
  controlActive: StyleProp<ViewStyle>;
  controlDisabled?: StyleProp<ViewStyle>;
}

const TIGHT_CONTROL_HEIGHT = 28;
const COMPACT_CONTROL_HEIGHT = 32;
const FIELD_CONTROL_HEIGHT = 44;
export const HEADER_CONTROL_HEIGHT = 26;
const SEGMENTED_TIGHT_INSET = 2;
const SEGMENTED_COMPACT_INSET = 2;
const SEGMENTED_FIELD_INSET = 3;
const SWITCH_TRACK_WIDTH = 34;
const SWITCH_TRACK_HEIGHT = 20;
const SWITCH_THUMB_SIZE = 16;
const CONTROL_FOCUS_RING_WIDTH = 2;
const CONTROL_FOCUS_RING_OFFSET = 1;
const CONTROL_CENTER_JUSTIFY_CONTENT = "center";
const FIELD_TEXT_LINE_HEIGHT_RATIO = 1.4;

/**
 * The three control heights every button, field, and segmented control is built from.
 * Exported so a row that hosts one of those controls can size itself from the same
 * numbers instead of guessing a height the control then outgrows.
 */
export const CONTROL_HEIGHTS = {
  tight: TIGHT_CONTROL_HEIGHT,
  compact: COMPACT_CONTROL_HEIGHT,
  field: FIELD_CONTROL_HEIGHT,
};

export const buttonControlHeight: Record<ButtonControlSize, number> = {
  xs: CONTROL_HEIGHTS.tight,
  sm: CONTROL_HEIGHTS.compact,
  md: CONTROL_HEIGHTS.field,
  lg: CONTROL_HEIGHTS.field,
};

export const buttonIconSize: Record<ButtonControlSize, number> = {
  xs: ICON_SIZE.xs,
  sm: ICON_SIZE.sm,
  md: ICON_SIZE.md,
  lg: ICON_SIZE.lg,
};

export const segmentedIconSize: Record<SegmentedControlSize, number> = {
  xs: ICON_SIZE.xs,
  sm: ICON_SIZE.sm,
  md: ICON_SIZE.md,
};

export const switchGeometry = {
  trackWidth: SWITCH_TRACK_WIDTH,
  trackHeight: SWITCH_TRACK_HEIGHT,
  thumbSize: SWITCH_THUMB_SIZE,
  thumbTravel: SWITCH_TRACK_WIDTH - SWITCH_THUMB_SIZE - (SWITCH_TRACK_HEIGHT - SWITCH_THUMB_SIZE),
};

function fieldLineHeight(fontSize: number): number {
  return Math.round(fontSize * FIELD_TEXT_LINE_HEIGHT_RATIO);
}

function fieldVerticalPadding(
  controlHeight: number,
  lineHeight: number,
  borderWidth: number,
): number {
  return (controlHeight - lineHeight - borderWidth * 2) / 2;
}

export function getControlInteractionPhase(
  state: ControlInteractionState,
): ControlInteractionPhase {
  if (state.disabled) {
    return "rest";
  }
  if (state.active || state.focused || state.open || state.pressed) {
    return "active";
  }
  if (state.hovered) {
    return "hover";
  }
  return "rest";
}

export function resolveControlInteractionStyles(
  styles: ControlInteractionStyleMap,
  state: ControlInteractionState,
): StyleProp<ViewStyle> {
  const phase = getControlInteractionPhase(state);
  return [
    styles.controlRest,
    phase === "hover" ? styles.controlHover : null,
    phase === "active" ? styles.controlActive : null,
    state.disabled ? styles.controlDisabled : null,
  ];
}

/** Compact-density heights (Inset). The tight row stays at 28 so split buttons that pin
 * `buttonControlHeight.xs` still line up with the Buttons beside them. */
const DENSE_CONTROL_HEIGHTS: typeof CONTROL_HEIGHTS = { tight: 28, compact: 30, field: 36 };

/** Control heights for the active design: only a compact-density direction shrinks them. */
export function designControlHeights(theme: Theme): typeof CONTROL_HEIGHTS {
  const design = theme.design;
  if (design && design.variant !== "current" && design.density === "compact") {
    return DENSE_CONTROL_HEIGHTS;
  }
  return CONTROL_HEIGHTS;
}

/**
 * Corner radius for a button, field, or segment. `current` keeps its size-based ramp; a design
 * direction uses its single `controlRadius` (999 = pill), so every control shares one shape.
 */
export function designControlRadius(theme: Theme, currentRadius: number): number {
  const design = theme.design;
  if (!design || design.variant === "current") return currentRadius;
  return design.controlRadius;
}

/** Resting field border: directions with hairlines (Inset, Mono) outline inputs at rest. */
function fieldRestBorderColor(theme: Theme): string {
  const design = theme.design;
  if (!design || design.variant === "current" || design.borderless) return "transparent";
  return theme.colors.border;
}

/** Field fill: Mono draws inputs as outlined page-colour boxes; everyone else tints them. */
function fieldSurfaceColor(theme: Theme): string {
  if (theme.design?.variant === "mono") return theme.colors.surface0;
  if (theme.design?.variant === "focus") return theme.colors.surface1;
  return theme.colors.surface2;
}

export function createControlGeometry(theme: Theme) {
  const controlBorderWidth = theme.borderWidth[1];
  const heights = designControlHeights(theme);
  const radius = (currentRadius: number) => designControlRadius(theme, currentRadius);
  const fieldTextSmLineHeight = fieldLineHeight(theme.fontSize.base);
  const fieldTextMdLineHeight = fieldLineHeight(theme.fontSize.base);
  const fieldControlSm = {
    minHeight: heights.compact,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: fieldVerticalPadding(
      heights.compact,
      fieldTextSmLineHeight,
      controlBorderWidth,
    ),
    borderRadius: radius(theme.borderRadius.md),
  };
  const fieldControlMd = {
    minHeight: heights.field,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: fieldVerticalPadding(heights.field, fieldTextMdLineHeight, controlBorderWidth),
    borderRadius: radius(theme.borderRadius.lg),
  };
  const fieldTextSm = {
    fontSize: theme.fontSize.base,
    lineHeight: fieldTextSmLineHeight,
  };
  const fieldTextMd = {
    fontSize: theme.fontSize.base,
    lineHeight: fieldTextMdLineHeight,
  };
  const switchControl = {
    minHeight: heights.compact,
    justifyContent: CONTROL_CENTER_JUSTIFY_CONTENT,
  } satisfies { minHeight: number; justifyContent: "center" };

  return {
    buttonXs: {
      minHeight: heights.tight,
      paddingHorizontal: theme.spacing[3],
      borderRadius: radius(theme.borderRadius.md),
    },
    buttonSm: {
      minHeight: heights.compact,
      paddingHorizontal: theme.spacing[3],
      borderRadius: radius(theme.borderRadius.md),
    },
    buttonMd: {
      minHeight: heights.field,
      paddingHorizontal: theme.spacing[4],
      borderRadius: radius(theme.borderRadius.lg),
    },
    buttonLg: {
      minHeight: heights.field,
      paddingHorizontal: theme.spacing[6],
      borderRadius: radius(theme.borderRadius.xl),
    },
    buttonText: {
      fontSize: theme.fontSize.base,
    },
    buttonTextXs: {
      fontSize: theme.fontSize.sm,
    },
    formTextInputSm: {
      ...fieldControlSm,
      ...fieldTextSm,
    },
    formTextInputMd: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    formTextInput: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    fieldControlSm,
    fieldControlMd,
    fieldSurface: { backgroundColor: fieldSurfaceColor(theme) },
    fieldTextSm,
    fieldTextMd,
    controlRest: {
      borderWidth: controlBorderWidth,
      borderColor: fieldRestBorderColor(theme),
      outlineWidth: 0,
      outlineColor: "transparent",
    },
    controlHover: {
      borderColor: theme.colors.borderAccent,
    },
    controlActive: {
      borderColor: theme.colors.borderAccent,
      outlineColor: theme.colors.accent,
      outlineOffset: CONTROL_FOCUS_RING_OFFSET,
      outlineStyle: "solid" as const,
      outlineWidth: CONTROL_FOCUS_RING_WIDTH,
    },
    controlFocusRingColor: {
      outlineColor: theme.colors.accent,
    },
    controlDisabled: {
      opacity: theme.opacity[50],
    },
    switchControl,
    segmentedContainerXs: {
      minHeight: heights.tight,
      padding: 0,
    },
    segmentedContainerSm: {
      minHeight: heights.compact,
      padding: 0,
    },
    segmentedContainerMd: {
      minHeight: heights.field,
      padding: 0,
    },
    segmentedSegmentXs: {
      minHeight: heights.tight - SEGMENTED_TIGHT_INSET * 2,
      paddingHorizontal: theme.spacing[2],
      borderRadius: radius(theme.borderRadius.md),
    },
    segmentedSegmentSm: {
      minHeight: heights.compact - SEGMENTED_COMPACT_INSET * 2,
      paddingHorizontal: theme.spacing[2],
      borderRadius: radius(theme.borderRadius.md),
    },
    segmentedSegmentMd: {
      minHeight: heights.field - SEGMENTED_FIELD_INSET * 2,
      paddingHorizontal: theme.spacing[3],
      borderRadius: radius(theme.borderRadius.lg),
    },
    segmentedLabelXs: {
      fontSize: theme.fontSize.sm,
    },
    segmentedLabelSm: {
      fontSize: theme.fontSize.base,
    },
    segmentedLabelMd: {
      fontSize: theme.fontSize.base,
    },
  };
}
