import { describe, expect, it } from "vitest";
import { alpha, DEFAULT_THEME_ID, resolveTheme, rgbOf, THEMES } from "./themes";

const lum = (hex: string) => {
  const [r, g, b] = rgbOf(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("themes", () => {
  it("defaults to Material and keeps Blue Tech available", () => {
    expect(DEFAULT_THEME_ID).toBe("material");
    expect(resolveTheme(null).def.id).toBe("material");
    expect(resolveTheme({ id: "nope" }).def.id).toBe("material");
    expect(THEMES.map((t) => t.id)).toContain("blue-tech");
  });

  it("keeps Blue Tech's original pinned values", () => {
    const c = resolveTheme({ id: "blue-tech" }).color;
    expect(c.bg).toBe("#080b0d");
    expect(c.cyan).toBe("#25b5c8");
    expect(c.cyanWash).toBe("rgba(37,181,200,0.1)");
  });

  it("gives every theme every token as a 6-digit hex or rgba", () => {
    const keys = Object.keys(resolveTheme({ id: "blue-tech" }).color).sort();
    for (const t of THEMES) {
      const c = resolveTheme({ id: t.id }).color;
      expect(Object.keys(c).sort()).toEqual(keys);
      for (const v of Object.values(c)) expect(v).toMatch(/^(#[0-9a-f]{6}|rgba\([\d,.]+\))$/i);
    }
  });

  it("applies valid overrides and re-derives washes from them", () => {
    const c = resolveTheme({ id: "blue-tech", overrides: { cyan: "#ff0000", bg: "nope" } }).color;
    expect(c.cyan).toBe("#ff0000");
    expect(c.cyanWash).toBe("rgba(255,0,0,0.1)");
    expect(c.bg).toBe("#080b0d");
  });

  it("alpha() expands short hex and passes non-hex through", () => {
    expect(alpha("#fff", 0.5)).toBe("rgba(255,255,255,0.5)");
    expect(alpha("transparent", 0.5)).toBe("transparent");
  });

  it("Material Light meets WCAG AA for text on every surface and on accent fills", () => {
    const c = resolveTheme({ id: "material-light" }).color;
    expect(resolveTheme({ id: "material-light" }).def.scheme).toBe("light");
    const surfaces = [c.bg, c.bg2, c.panel, c.raise];
    const texts = [
      c.text,
      c.muted,
      c.faint,
      c.cyan,
      c.cyan2,
      c.deep,
      c.mint,
      c.violet,
      c.amber,
      c.coral,
      c.addText,
      c.delText,
    ];
    for (const fg of texts)
      for (const surface of surfaces) expect(contrast(fg, surface)).toBeGreaterThanOrEqual(4.5);
    for (const fill of [c.cyan, c.cyan2, c.deep, c.mint, c.coral])
      expect(contrast(c.onAccent, fill)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c.onWarn, c.amber)).toBeGreaterThanOrEqual(4.5);
  });

  it("Material Light's syntax and label colours stay readable on the panel", () => {
    const t = resolveTheme({ id: "material-light" });
    for (const v of [...Object.values(t.syntax), ...Object.values(t.labelTint)])
      expect(contrast(v, t.color.panel)).toBeGreaterThanOrEqual(4.5);
  });
});
