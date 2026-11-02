/**
 * Colour themes, VS Code style: each theme is a named palette, and the user can override any
 * token on top of it (Settings → Appearance). The active theme is read once at startup
 * (`theme/stored`) and resolved into the `color`, `syntax`, `labelTint` and `terminal` tokens,
 * so switching reloads the app; module-level stylesheets read the tokens when they load.
 *
 * Every colour a component draws comes from here. `alpha()` derives washes from a token, so a
 * token override carries through to everything that tints with it.
 */

/** The palette a theme declares. Accent keys keep their historical names (`cyan` is the accent). */
export interface Palette {
  /** App background, a step lighter, panels, raised surfaces. */
  bg: string;
  bg2: string;
  panel: string;
  raise: string;
  /** Text: primary, secondary, tertiary. */
  text: string;
  muted: string;
  faint: string;
  /** Primary accent, its light tint and its deep shade. */
  cyan: string;
  cyan2: string;
  deep: string;
  /** Status hues: success, secondary accent, warning, danger. */
  mint: string;
  violet: string;
  amber: string;
  coral: string;
  /** Text on an accent fill, text on a warning fill. */
  onAccent: string;
  onWarn: string;
  /** Diff text on the added / removed washes. */
  addText: string;
  delText: string;
  /** The colour hairlines and hover washes are drawn in (white on dark themes). */
  ink: string;
  /** Drop-shadow colour. */
  shadow: string;
}

/** Derived tokens; a theme may pin any of them, otherwise they come from the palette. */
export interface Derived {
  line: string;
  line2: string;
  wash: string;
  wash2: string;
  wash3: string;
  scrim: string;
  coralWash: string;
  cyanWash: string;
  cyanWash2: string;
  cyanWash3: string;
  cyanDim: string;
  mintDim: string;
}

export type ColorTokens = Palette & Derived;
export type ColorKey = keyof ColorTokens;

export type SyntaxTokens = Record<string, string>;

export interface TerminalColors {
  black: string;
  blue: string;
  white: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightWhite: string;
}

export interface ThemeDef {
  id: string;
  label: string;
  description: string;
  palette: Palette & Partial<Derived>;
  syntax: SyntaxTokens;
  terminal: TerminalColors;
}

/** `#rgb` / `#rrggbb` (any alpha suffix dropped) as `rgba(r,g,b,a)`. Non-hex input passes through. */
export function alpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3 || h.length === 4
      ? h
          .slice(0, 3)
          .split("")
          .map((c) => c + c)
          .join("")
      : h.slice(0, 6);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const n = Number.parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** `#rrggbb` as `[r, g, b]` (black for anything else). */
export function rgbOf(hex: string): [number, number, number] {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  const n = m ? Number.parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix `hex` towards black by `k` (0–1); used for the dim accent shades. */
function darken(hex: string, k: number): string {
  const m = /^#([0-9a-fA-F]{6})/.exec(hex);
  if (!m) return hex;
  const n = Number.parseInt(m[1], 16);
  const ch = (v: number) =>
    Math.round(v * (1 - k))
      .toString(16)
      .padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

const LABEL_TINT: Record<string, string> = {
  violet: "#a392d5",
  sky: "#6aa6ce",
  emerald: "#6cae96",
  orange: "#cc8f64",
  pink: "#d87da3",
  indigo: "#9299d5",
  teal: "#6cacab",
  red: "#d88381",
  amber: "#b29d64",
  blue: "#7ba1d5",
};

/** Material: neutral graphite surfaces, one calm blue accent, Material-palette status hues. */
const material: ThemeDef = {
  id: "material",
  label: "Material",
  description: "Neutral graphite with a calm blue accent. Minimal glow.",
  palette: {
    bg: "#16181b",
    bg2: "#1a1d20",
    panel: "#1d2024",
    raise: "#25292d",
    text: "#eceff1",
    muted: "#a3abb2",
    faint: "#6c757d",
    cyan: "#82aaff",
    cyan2: "#b0c9ff",
    deep: "#3f5fa8",
    mint: "#8fcf96",
    violet: "#c3a6ef",
    amber: "#ffcb6b",
    coral: "#f07178",
    onAccent: "#0f1a2e",
    onWarn: "#1f1600",
    addText: "#c2e6c6",
    delText: "#ffc4c8",
    ink: "#ffffff",
    shadow: "#000000",
    line: "rgba(255,255,255,0.07)",
    line2: "rgba(255,255,255,0.14)",
    scrim: "rgba(10,11,13,0.6)",
  },
  syntax: {
    keyword: "#c792ea",
    comment: "#6c757d",
    string: "#c3e88d",
    number: "#f78c6c",
    literal: "#f78c6c",
    function: "#82aaff",
    definition: "#82aaff",
    class: "#ffcb6b",
    type: "#ffcb6b",
    tag: "#f07178",
    attribute: "#c792ea",
    property: "#b2ccd6",
    variable: "#eceff1",
    operator: "#89ddff",
    punctuation: "#a3abb2",
    regexp: "#89ddff",
    escape: "#f78c6c",
    meta: "#6c757d",
    heading: "#82aaff",
    link: "#80cbc4",
  },
  terminal: {
    black: "#1d2024",
    blue: "#82aaff",
    white: "#d5dade",
    brightRed: "#ff9aa0",
    brightGreen: "#c3e88d",
    brightYellow: "#ffd98e",
    brightBlue: "#a8c4ff",
    brightMagenta: "#d6b8f5",
    brightWhite: "#ffffff",
  },
};

/** Blue Tech: the original Bracket + Rail palette (round-3 mockups, r3.css), unchanged. */
const blueTech: ThemeDef = {
  id: "blue-tech",
  label: "Blue Tech",
  description: "The original deep-teal Bracket look with cyan glow.",
  palette: {
    bg: "#080b0d",
    bg2: "#0c1114",
    panel: "#0e1418",
    raise: "#131b20",
    text: "#f2f6f7",
    muted: "#9aa6a9",
    faint: "#5f6b6e",
    cyan: "#25b5c8",
    cyan2: "#7fd9e6",
    deep: "#045b9d",
    mint: "#3fcf8e",
    violet: "#8b7cf6",
    amber: "#f5b84a",
    coral: "#ff6b6b",
    onAccent: "#04161a",
    onWarn: "#1a1204",
    addText: "#a6ecc8",
    delText: "#ffb3b3",
    ink: "#ffffff",
    shadow: "#000000",
    line: "rgba(255,255,255,0.08)",
    line2: "rgba(255,255,255,0.16)",
    wash: "rgba(255,255,255,0.03)",
    wash2: "rgba(255,255,255,0.05)",
    wash3: "rgba(255,255,255,0.1)",
    scrim: "rgba(4,8,10,0.6)",
    coralWash: "rgba(255,107,107,0.08)",
    cyanWash: "rgba(37,181,200,0.1)",
    cyanWash2: "rgba(37,181,200,0.18)",
    cyanWash3: "rgba(37,181,200,0.28)",
    cyanDim: "#1e9aab",
    mintDim: "#33b47a",
  },
  syntax: {
    keyword: "#8b7cf6",
    comment: "#5f6b6e",
    string: "#7fe3b2",
    number: "#f5b84a",
    literal: "#f5b84a",
    function: "#7fd9e6",
    definition: "#7fd9e6",
    class: "#ffcf7a",
    type: "#b1a6fa",
    tag: "#7fd9e6",
    attribute: "#f5b84a",
    property: "#c9e6ea",
    variable: "#f2f6f7",
    operator: "#9aa6a9",
    punctuation: "#9aa6a9",
    regexp: "#7fe3b2",
    escape: "#f5b84a",
    meta: "#5f6b6e",
    heading: "#7fd9e6",
    link: "#25b5c8",
  },
  terminal: {
    black: "#0c1114",
    blue: "#4aa3df",
    white: "#d6dee0",
    brightRed: "#ff8f8f",
    brightGreen: "#7fe3b2",
    brightYellow: "#ffd27a",
    brightBlue: "#7fc0ef",
    brightMagenta: "#b1a6fa",
    brightWhite: "#ffffff",
  },
};

export const THEMES: ThemeDef[] = [material, blueTech];
export const DEFAULT_THEME_ID = material.id;

/** The stored choice: a theme id plus per-token overrides (`#rrggbb`). */
export interface ThemeChoice {
  id: string;
  overrides: Partial<Record<ColorKey, string>>;
}

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Keys a user can override, in the order Settings lists them. */
export const OVERRIDABLE: ColorKey[] = [
  "bg",
  "bg2",
  "panel",
  "raise",
  "text",
  "muted",
  "faint",
  "cyan",
  "cyan2",
  "deep",
  "mint",
  "violet",
  "amber",
  "coral",
  "onAccent",
];

export interface ResolvedTheme {
  def: ThemeDef;
  color: ColorTokens;
  syntax: SyntaxTokens;
  labelTint: Record<string, string>;
  terminal: TerminalColors;
}

export function findTheme(id: string | undefined): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

/** Palette + valid overrides → every colour token. Derived tokens follow overridden base keys. */
export function resolveTheme(choice: Partial<ThemeChoice> | null | undefined): ResolvedTheme {
  const def = findTheme(choice?.id);
  const overrides: Partial<Record<ColorKey, string>> = {};
  for (const [k, v] of Object.entries(choice?.overrides ?? {})) {
    if (typeof v === "string" && HEX_COLOR.test(v)) overrides[k as ColorKey] = v;
  }
  const p = { ...def.palette, ...overrides };
  // A pinned derived value only stands while the base key it came from is not overridden.
  const pin = (k: keyof Derived, base: keyof Palette) =>
    base in overrides ? undefined : def.palette[k];
  const derived: Derived = {
    line: pin("line", "ink") ?? alpha(p.ink, 0.08),
    line2: pin("line2", "ink") ?? alpha(p.ink, 0.16),
    wash: pin("wash", "ink") ?? alpha(p.ink, 0.03),
    wash2: pin("wash2", "ink") ?? alpha(p.ink, 0.05),
    wash3: pin("wash3", "ink") ?? alpha(p.ink, 0.1),
    scrim: pin("scrim", "bg") ?? alpha(p.bg, 0.6),
    coralWash: pin("coralWash", "coral") ?? alpha(p.coral, 0.08),
    cyanWash: pin("cyanWash", "cyan") ?? alpha(p.cyan, 0.1),
    cyanWash2: pin("cyanWash2", "cyan") ?? alpha(p.cyan, 0.18),
    cyanWash3: pin("cyanWash3", "cyan") ?? alpha(p.cyan, 0.28),
    cyanDim: pin("cyanDim", "cyan") ?? darken(p.cyan, 0.17),
    mintDim: pin("mintDim", "mint") ?? darken(p.mint, 0.13),
  };
  const color: ColorTokens = { ...p, ...derived, ...overrides } as ColorTokens;
  return {
    def,
    color,
    syntax: { ...def.syntax },
    labelTint: { ...LABEL_TINT },
    terminal: { ...def.terminal },
  };
}
