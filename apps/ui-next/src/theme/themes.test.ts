import { describe, expect, it } from "vitest";
import { alpha, DEFAULT_THEME_ID, resolveTheme, THEMES } from "./themes";

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
});
