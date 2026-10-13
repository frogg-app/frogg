/** Height of the app-drawn title bar; the native window controls overlay it. Matches TitleBar.tsx. */
const TITLE_BAR_HEIGHT = 32;
const BACKGROUND = "#080b0d";
const SYMBOLS = "#9aa6a9";

/** Which chrome the UI draws for a platform: "windows", "linux" or "mac". */
function chromeMode(platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "mac";
  return "linux";
}

/**
 * Frameless window options. Windows and Linux hide the native title bar and menu and keep the
 * OS caption buttons as a title bar overlay (so Windows 11 snap layouts still open on the
 * maximise button); macOS keeps its traffic lights inset into the same strip.
 */
function windowChromeOptions(platform) {
  if (platform === "darwin") {
    return { titleBarStyle: "hiddenInset", trafficLightPosition: { x: 12, y: 10 } };
  }
  return {
    titleBarStyle: "hidden",
    titleBarOverlay: { color: BACKGROUND, symbolColor: SYMBOLS, height: TITLE_BAR_HEIGHT },
    autoHideMenuBar: true,
  };
}

/**
 * The menu-bar accelerators worth keeping once Windows/Linux lose the menu. Text editing
 * (copy, paste, undo, select all) is handled by Chromium itself and needs no menu.
 * Returns the action name for a `before-input-event` input, or null.
 */
function acceleratorFor(input) {
  if (input.type !== "keyDown") return null;
  const mod = input.control || input.meta;
  const key = String(input.key).toLowerCase();
  if (key === "f11") return "fullscreen";
  if (key === "f5" || (mod && !input.shift && key === "r")) return "reload";
  if (key === "f12" || (mod && input.shift && key === "i")) return "devtools";
  if (mod && (key === "=" || key === "+")) return "zoomIn";
  if (mod && key === "-") return "zoomOut";
  if (mod && key === "0") return "zoomReset";
  return null;
}

module.exports = { TITLE_BAR_HEIGHT, chromeMode, windowChromeOptions, acceleratorFor };
