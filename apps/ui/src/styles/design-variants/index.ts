import {
  buildDarkSemanticColors,
  buildDarkTheme,
  buildLightSemanticColors,
  buildLightTheme,
  CURRENT_DESIGN,
  darkTheme,
  lightTheme,
  REGISTERED_THEMES,
  type DesignTokens,
  type DesignVariantId,
} from "../theme";
import type { DesignVariantDefinition } from "./definition";
import { insetVariant } from "./inset";
import { monoVariant } from "./mono";
import { paperVariant } from "./paper";
import { focusVariant } from "./focus";
import { softVariant } from "./soft";

// UI refresh exploration: five complete design directions, each a light + dark theme pair plus
// structural tokens (`theme.design`). Each direction is distilled from reference products on
// Mobbin, named in `references` so reviewers can compare against the source.
export const DESIGN_VARIANTS: readonly DesignVariantDefinition[] = [
  insetVariant,
  monoVariant,
  paperVariant,
  focusVariant,
  softVariant,
];

export type DesignScheme = "light" | "dark";

export function designThemeKey(
  variant: Exclude<DesignVariantId, "current">,
  scheme: DesignScheme,
): `${Exclude<DesignVariantId, "current">}${"Light" | "Dark"}` {
  return `${variant}${scheme === "light" ? "Light" : "Dark"}`;
}

function buildVariantThemes(definition: DesignVariantDefinition) {
  const design: DesignTokens = { variant: definition.id, ...definition.design };
  return {
    [designThemeKey(definition.id, "light")]: buildLightTheme(
      buildLightSemanticColors(definition.light),
      { borderRadius: definition.borderRadius, shadow: definition.lightShadow, design },
    ),
    [designThemeKey(definition.id, "dark")]: buildDarkTheme(
      buildDarkSemanticColors(definition.dark),
      { borderRadius: definition.borderRadius, shadow: definition.darkShadow, design },
    ),
  };
}

type DesignThemeKey = ReturnType<typeof designThemeKey>;

export const DESIGN_VARIANT_THEMES = Object.assign(
  {},
  ...DESIGN_VARIANTS.map(buildVariantThemes),
) as Record<DesignThemeKey, typeof lightTheme | typeof darkTheme>;

/** Every theme Unistyles knows about: the shipping catalog plus the design variants. */
export const ALL_REGISTERED_THEMES = {
  ...REGISTERED_THEMES,
  ...DESIGN_VARIANT_THEMES,
};

export function getDesignVariant(id: DesignVariantId): DesignVariantDefinition | null {
  return DESIGN_VARIANTS.find((variant) => variant.id === id) ?? null;
}

export const DESIGN_VARIANT_IDS: readonly DesignVariantId[] = [
  "current",
  ...DESIGN_VARIANTS.map((variant) => variant.id),
];

export { CURRENT_DESIGN };
