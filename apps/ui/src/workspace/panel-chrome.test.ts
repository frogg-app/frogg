import { describe, expect, it } from "vitest";
import { themeOf } from "@/styles/design-theme";
import { designThemeKey } from "@/styles/design-variants";
import type { Theme } from "@/styles/theme";
import {
  panelAlpha,
  panelStatusDot,
  panelTabChrome,
  panelTerminalFrame,
  panelTreeRowChrome,
} from "./panel-chrome";

const VARIANTS = ["inset", "mono", "paper", "focus", "soft"] as const;
const TAB_BASE = { radius: 6, hovered: "#111111", active: "#222222", activeUnfocused: "#333333" };
const ROW_BASE = { paddingVertical: 6, active: "#444444" };

function themes(): Theme[] {
  return [themeOf("dark"), ...VARIANTS.map((variant) => themeOf(designThemeKey(variant, "dark")))];
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe("panelAlpha", () => {
  it("mixes hex colours directly", () => {
    expect(panelAlpha("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
  });

  it("mixes web CSS variables in CSS instead of throwing", () => {
    expect(panelAlpha("var(--colors-accent)", 0.12)).toBe(
      "color-mix(in srgb, var(--colors-accent) 12%, transparent)",
    );
  });
});

// Unistyles web keeps a CSS property a recompute stops naming, so a live design switch would leave
// the previous direction's value behind unless every direction emits the same keys.
describe("live-switch key parity", () => {
  // Keys the caller's base style always sets come back from the base, so they are exempt.
  it.each([
    ["tab", (theme: Theme) => panelTabChrome(theme, TAB_BASE).tab, ["borderRadius"]],
    ["tab label", (theme: Theme) => panelTabChrome(theme, TAB_BASE).label, []],
    ["tree row", (theme: Theme) => panelTreeRowChrome(theme, ROW_BASE).row, ["paddingVertical"]],
    ["terminal frame", (theme: Theme) => panelTerminalFrame(theme), ["backgroundColor"]],
    ["status dot", (theme: Theme) => panelStatusDot(theme, "statusDotSuccess", 6), []],
  ] as const)("%s never names a key the shipping design leaves out", (_name, build, fromBase) => {
    const [shipping, ...rest] = themes().map((theme) => sortedKeys(build(theme)));
    const allowed = new Set<string>([...(shipping ?? []), ...fromBase]);
    for (const keys of rest) expect(keys.filter((key) => !allowed.has(key))).toEqual([]);
  });
});
