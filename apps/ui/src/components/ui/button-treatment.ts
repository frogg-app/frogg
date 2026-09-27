import type { ViewFragment, TextFragment } from "@/styles/style-fragment";
import type { Theme } from "@/styles/theme";
import { designThemeOf } from "@/components/ui/design-surface";

interface Fill {
  backgroundColor: string;
  borderColor: string;
}

export interface ButtonTreatment {
  default: Fill;
  secondary: Fill;
  outline: Fill;
  destructive: Fill;
  /** Ghost buttons stay transparent at rest; a direction may give them a hover wash. */
  ghostHovered: ViewFragment;
  textWeight: TextFragment["fontWeight"];
  /** Inset reads a step smaller than the rest of the app's controls. */
  fontSizeDelta: number;
}

function fill(backgroundColor: string, borderColor = backgroundColor): Fill {
  return { backgroundColor, borderColor };
}

/**
 * How each button variant is painted in the active design direction. `current` returns exactly
 * the shipping treatment, so the Button's own styles stay a no-op there.
 *
 * - Mono: solid black/white primary, page-coloured secondary with a hairline.
 * - Soft: tinted pill secondary, bolder labels (the pill shape comes from `controlRadius`).
 * - Paper: warm tinted secondary with no line, terracotta primary.
 * - Focus: quiet near-invisible secondary so the one blue primary carries the screen.
 * - Inset: compact indigo primary, hairline-bordered secondary, slightly smaller labels.
 */
export function buttonTreatment(theme: Theme): ButtonTreatment {
  const c = theme.colors;
  const shared = {
    default: fill(c.accent),
    destructive: fill(c.destructive),
  };
  switch (theme.design.variant) {
    case "mono":
      return {
        ...shared,
        secondary: fill(c.surface0, c.borderAccent),
        outline: fill("transparent", c.borderAccent),
        ghostHovered: { backgroundColor: c.surface2 },
        textWeight: theme.fontWeight.medium,
        fontSizeDelta: 0,
      };
    case "soft":
      return {
        ...shared,
        secondary: fill(c.surface2),
        outline: fill("transparent", c.border),
        ghostHovered: { backgroundColor: c.surface2 },
        textWeight: theme.fontWeight.semibold,
        fontSizeDelta: 0,
      };
    case "paper":
      return {
        ...shared,
        secondary: fill(c.surface2),
        outline: fill("transparent", c.border),
        ghostHovered: { backgroundColor: c.surface2 },
        textWeight: theme.fontWeight.medium,
        fontSizeDelta: 0,
      };
    case "focus":
      return {
        ...shared,
        secondary: fill(c.surface1),
        outline: fill("transparent", c.border),
        ghostHovered: { backgroundColor: c.surface1 },
        textWeight: theme.fontWeight.medium,
        fontSizeDelta: 0,
      };
    case "inset":
      return {
        ...shared,
        secondary: fill(c.surface2, c.border),
        outline: fill("transparent", c.border),
        ghostHovered: { backgroundColor: c.surface2 },
        textWeight: theme.fontWeight.medium,
        fontSizeDelta: -1,
      };
    case "current":
      return {
        ...shared,
        secondary: fill(c.surface3),
        outline: fill("transparent", c.borderAccent),
        ghostHovered: {},
        textWeight: theme.fontWeight.normal,
        fontSizeDelta: 0,
      };
  }
}

/**
 * Button label type for `themeName`: the direction's weight plus the Inset size step. `base` is
 * the regular label, `xs` the extra-small one.
 */
export function buttonText(
  theme: Theme,
  themeName: string | undefined,
  size: "base" | "xs",
): TextFragment {
  const treatment = buttonTreatment(designThemeOf(theme, themeName));
  if (size === "xs") return { fontSize: theme.fontSize.sm + treatment.fontSizeDelta };
  return {
    fontSize: theme.fontSize.base + treatment.fontSizeDelta,
    fontWeight: treatment.textWeight,
  };
}
