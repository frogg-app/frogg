import { ALL_REGISTERED_THEMES } from "./design-variants";
import type { DesignTokens } from "./theme";

type RegisteredTheme = (typeof ALL_REGISTERED_THEMES)[keyof typeof ALL_REGISTERED_THEMES];

// On web, Unistyles runs with CSS variables: inside `StyleSheet.create` every string leaf of
// `theme` (colors, `design.variant`, `design.frame`, font families…) is a `var(--…)` reference,
// and numbers/booleans are frozen at the first compute. Branch on the real theme instead, and
// reference `rt.themeName` inside the style value so the style recomputes on a theme switch:
//
//   frame: frameStyle(designOf(rt.themeName)),
export function themeOf(themeName: string | undefined): RegisteredTheme {
  const registered = ALL_REGISTERED_THEMES as Record<string, RegisteredTheme>;
  return registered[themeName ?? ""] ?? ALL_REGISTERED_THEMES.dark;
}

export function designOf(themeName: string | undefined): DesignTokens {
  return themeOf(themeName).design;
}
