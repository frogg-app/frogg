const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_WINDOW_THEME,
  normalizeWindowTheme,
  readWindowTheme,
  writeWindowTheme,
} = require("./window-theme.cjs");

test("a first launch uses the default theme's colours", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "frogg-window-theme-"));
  try {
    assert.deepEqual(readWindowTheme(dir), DEFAULT_WINDOW_THEME);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saved colours come back on the next launch", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "frogg-window-theme-"));
  try {
    writeWindowTheme(dir, {
      bg: "#f5f6f8",
      faint: "#5f6873",
      accent: "#2557c2",
      symbols: "#4a535e",
    });
    assert.equal(readWindowTheme(dir).bg, "#f5f6f8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("anything but #rrggbb falls back per key", () => {
  const theme = normalizeWindowTheme({ bg: "red", accent: "#2557c2", extra: "#000000" });
  assert.equal(theme.bg, DEFAULT_WINDOW_THEME.bg);
  assert.equal(theme.accent, "#2557c2");
  assert.equal("extra" in theme, false);
});
