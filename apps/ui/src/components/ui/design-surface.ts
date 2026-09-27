import { themeOf } from "@/styles/design-theme";
import type { Theme } from "@/styles/theme";
import { createControlGeometry } from "@/components/ui/control-geometry";

// Shared primitives and settings read design tokens through these helpers. On web the stylesheet
// `theme` carries CSS-variable strings (`design.variant`, `colorScheme`, font families), so any
// branch on them is always false there. The helpers swap in the real design tokens and colour
// scheme for the active theme name, and keep the stylesheet's own numbers (the user's font scale
// lands there) and colours (valid `var()` values that follow a live switch).
//
// Call them with `rt.themeName` written inside each style's value, e.g.
//   md: { ...controlGeometryOf(theme, rt.themeName).buttonMd },
// so the Unistyles babel plugin registers a theme-name dependency and the style recomputes when
// the design direction changes.

const resolved = new WeakMap<object, Map<string, Theme>>();
const geometries = new WeakMap<Theme, ReturnType<typeof createControlGeometry>>();

/** The stylesheet theme with real design tokens and colour scheme for `themeName`. */
export function designThemeOf(theme: Theme, themeName: string | undefined): Theme {
  const key = themeName ?? "";
  let byName = resolved.get(theme);
  if (!byName) {
    byName = new Map();
    resolved.set(theme, byName);
  }
  let next = byName.get(key);
  if (!next) {
    const real: Theme = themeOf(themeName);
    next = { ...theme, design: real.design, colorScheme: real.colorScheme } as Theme;
    byName.set(key, next);
  }
  return next;
}

/**
 * A corner from the active direction's radius ramp. Radii are not user-patched, so the registered
 * theme is exact, and reading it through `themeName` keeps menus and dialogs in step with a live
 * switch (the stylesheet's own numbers only refresh when something else recomputes the style).
 */
export function radiusOf(themeName: string | undefined, size: keyof Theme["borderRadius"]): number {
  return themeOf(themeName).borderRadius[size];
}

/** Control geometry (heights, radii, field chrome) for the active design direction. */
export function controlGeometryOf(theme: Theme, themeName: string | undefined) {
  const designTheme = designThemeOf(theme, themeName);
  let geometry = geometries.get(designTheme);
  if (!geometry) {
    geometry = createControlGeometry(designTheme);
    geometries.set(designTheme, geometry);
  }
  return geometry;
}
