// Shell colours for what paints before the UI bundle: the window background and the Windows/Linux
// title bar overlay. The UI sends the active theme's colours each launch (preload
// `setWindowTheme`); they are kept in the data folder so the next launch opens in them, with no
// flash of another theme. The splash reads the same colours from localStorage (splash.cjs).
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const path = require("node:path");

/** The default theme's (Material) colours, for a first launch with nothing saved. */
const DEFAULT_WINDOW_THEME = Object.freeze({
  bg: "#16181b",
  faint: "#6c757d",
  accent: "#82aaff",
  symbols: "#a3abb2",
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const FILE = "window-theme.json";

/** Keeps only valid `#rrggbb` values for the known keys, falling back to the default per key. */
function normalizeWindowTheme(value) {
  const out = { ...DEFAULT_WINDOW_THEME };
  if (!value || typeof value !== "object") return out;
  for (const key of Object.keys(DEFAULT_WINDOW_THEME)) {
    if (typeof value[key] === "string" && HEX.test(value[key])) out[key] = value[key];
  }
  return out;
}

function readWindowTheme(dir) {
  try {
    return normalizeWindowTheme(JSON.parse(readFileSync(path.join(dir, FILE), "utf8")));
  } catch {
    return { ...DEFAULT_WINDOW_THEME };
  }
}

function writeWindowTheme(dir, value) {
  const theme = normalizeWindowTheme(value);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, FILE), JSON.stringify(theme));
  return theme;
}

module.exports = { DEFAULT_WINDOW_THEME, normalizeWindowTheme, readWindowTheme, writeWindowTheme };
