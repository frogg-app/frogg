import { themeOf } from "@/styles/design-theme";
import type { ViewFragment } from "@/styles/style-fragment";

// Shared geometry for the soft regions. These only ever render under the soft direction, so the
// radii are literals; colours and shadows come from the real theme for `rt.themeName` (callers
// pass it inside each style value so a live light/dark switch recomputes them).

export const SOFT_CARD_RADIUS = 24;
export const SOFT_ROW_RADIUS = 16;
export const SOFT_PILL = 999;
export const SOFT_ROUND_BUTTON = 40;

/** A raised surface: the page colour lifted by a soft layered shadow, no border. */
export function softRaised(themeName: string | undefined, level: "sm" | "md" | "lg"): ViewFragment {
  const real = themeOf(themeName);
  return { backgroundColor: real.colors.surface0, ...real.shadow[level] };
}

/** A hairline that only shows in dark mode, where shadows alone do not separate surfaces. */
export function softEdge(themeName: string | undefined): ViewFragment {
  const real = themeOf(themeName);
  if (real.colorScheme !== "dark") return { borderWidth: 0 };
  return { borderWidth: 1, borderColor: real.colors.border };
}
