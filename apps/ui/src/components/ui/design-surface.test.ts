import { describe, expect, it } from "vitest";
import { controlGeometryOf, designThemeOf, radiusOf } from "@/components/ui/design-surface";
import { ALL_REGISTERED_THEMES } from "@/styles/design-variants";
import type { Theme } from "@/styles/theme";

// On web the stylesheet theme's strings are CSS variables; model that for the design tokens.
const cssTheme = {
  ...ALL_REGISTERED_THEMES.dark,
  colorScheme: "var(--color-scheme)",
  design: { ...ALL_REGISTERED_THEMES.dark.design, variant: "var(--design-variant)" },
} as unknown as Theme;

describe("design surface", () => {
  it("swaps in the real design tokens and colour scheme for the theme name", () => {
    const resolved = designThemeOf(cssTheme, "softLight");
    expect(resolved.design.variant).toBe("soft");
    expect(resolved.colorScheme).toBe("light");
    // Everything else stays the stylesheet's own (user font scale, CSS-variable colours).
    expect(resolved.fontSize).toBe(cssTheme.fontSize);
    expect(resolved.colors).toBe(cssTheme.colors);
  });

  it("returns a stable object per theme and name", () => {
    expect(designThemeOf(cssTheme, "monoDark")).toBe(designThemeOf(cssTheme, "monoDark"));
  });

  it("keeps the shipping control geometry for the current design", () => {
    const geometry = controlGeometryOf(cssTheme, "dark");
    expect(geometry.buttonMd.borderRadius).toBe(cssTheme.borderRadius.lg);
    expect(geometry.buttonMd.minHeight).toBe(44);
  });

  it("uses the direction's control radius and density", () => {
    expect(controlGeometryOf(cssTheme, "softLight").buttonSm.borderRadius).toBe(999);
    expect(controlGeometryOf(cssTheme, "insetDark").buttonMd.minHeight).toBe(36);
  });

  it("reads radii from the active direction's ramp", () => {
    expect(radiusOf("paperLight", "lg")).toBe(ALL_REGISTERED_THEMES.paperLight.borderRadius.lg);
  });
});
