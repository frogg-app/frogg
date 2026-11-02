const { test } = require("node:test");
const assert = require("node:assert/strict");
const { acceleratorFor, chromeMode, windowChromeOptions } = require("./window-chrome.cjs");

test("Windows and Linux are frameless with native caption buttons overlaid and no menu bar", () => {
  for (const platform of ["win32", "linux"]) {
    const options = windowChromeOptions(platform);
    assert.equal(options.titleBarStyle, "hidden");
    assert.equal(options.titleBarOverlay.height, 32);
    assert.equal(options.autoHideMenuBar, true);
  }
  assert.equal(chromeMode("win32"), "windows");
  assert.equal(chromeMode("linux"), "linux");
});

test("macOS insets its traffic lights into the title bar strip", () => {
  assert.equal(windowChromeOptions("darwin").titleBarStyle, "hiddenInset");
  assert.equal(chromeMode("darwin"), "mac");
});

test("keeps the useful menu accelerators", () => {
  const key = (k, mods = {}) => acceleratorFor({ type: "keyDown", key: k, ...mods });
  assert.equal(key("r", { control: true }), "reload");
  assert.equal(key("I", { control: true, shift: true }), "devtools");
  assert.equal(key("=", { control: true }), "zoomIn");
  assert.equal(key("-", { control: true }), "zoomOut");
  assert.equal(key("0", { control: true }), "zoomReset");
  assert.equal(key("F11"), "fullscreen");
  assert.equal(key("a", { control: true }), null);
  assert.equal(acceleratorFor({ type: "keyUp", key: "F5" }), null);
});

test("the title bar overlay follows the saved theme", () => {
  const options = windowChromeOptions("win32", {
    bg: "#f5f6f8",
    faint: "#5f6873",
    accent: "#2557c2",
    symbols: "#4a535e",
  });
  assert.equal(options.titleBarOverlay.color, "#f5f6f8");
  assert.equal(options.titleBarOverlay.symbolColor, "#4a535e");
});
