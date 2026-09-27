import { Platform } from "react-native";
import type {
  BORDER_RADIUS,
  DarkThemeConfig,
  DesignTokens,
  DesignVariantId,
  LightThemeConfig,
  ShadowScale,
  ThemeOverrides,
} from "../theme";

/** A web font stack with a native fallback (native has no web fonts; it falls back to system). */
export function stack(web: string, native: string): string {
  return Platform.select({ web, default: native }) ?? native;
}

export const SERIF_STACK = stack(
  "'Source Serif 4', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
  Platform.OS === "ios" ? "Georgia" : "serif",
);

export interface DesignVariantDefinition {
  id: Exclude<DesignVariantId, "current">;
  label: string;
  /** One line on the direction, shown in the switcher. */
  tagline: string;
  /** Mobbin reference products the direction is distilled from. */
  references: string[];
  light: LightThemeConfig;
  dark: DarkThemeConfig;
  borderRadius: ThemeOverrides["borderRadius"];
  lightShadow?: ShadowScale;
  darkShadow?: ShadowScale;
  design: Omit<DesignTokens, "variant">;
  /** Google Fonts families to load on web, e.g. "Inter:wght@400;500;600". */
  webFonts: string[];
}

export function radii(
  sm: number,
  base: number,
  md: number,
  lg: number,
  xl: number,
  xxl: number,
): Record<keyof typeof BORDER_RADIUS, number> {
  return { none: 0, sm, base, md, lg, xl, "2xl": xxl, full: 9999 };
}

export function shadow(color: string, alpha: [number, number, number], spread = 1): ShadowScale {
  const rgba = (a: number) => `rgba(${color}, ${a})`;
  return {
    sm: {
      shadowColor: rgba(alpha[0]),
      shadowOffset: { width: 0, height: 1 * spread },
      shadowRadius: 3 * spread,
      elevation: 2,
    },
    md: {
      shadowColor: rgba(alpha[1]),
      shadowOffset: { width: 0, height: 4 * spread },
      shadowRadius: 12 * spread,
      elevation: 6,
    },
    lg: {
      shadowColor: rgba(alpha[2]),
      shadowOffset: { width: 0, height: 12 * spread },
      shadowRadius: 32 * spread,
      elevation: 10,
    },
  };
}
