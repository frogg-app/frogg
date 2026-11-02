const { app, BrowserWindow, ipcMain, Menu, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { loadPackagedIdentity } = require("./identity.cjs");
const { resolveAsset } = require("./resolve-asset.cjs");
const {
  parseSessionWindowRequest,
  sessionWindowKey,
  sessionWindowQuery,
} = require("./session-window.cjs");
const { createUpdater } = require("./updater.cjs");
const { acceleratorFor, chromeMode, windowChromeOptions } = require("./window-chrome.cjs");

// Name, data folder and scheme come from the brand (identity.json, written by the build).
const identity = loadPackagedIdentity(path.join(__dirname, "identity.json"));
const { scheme } = identity;
app.setName(identity.name);
app.setPath("userData", path.join(app.getPath("appData"), identity.userDataDir));

// One instance per data folder: a second process would find the saved hosts locked by the first
// and come up unpaired. A second launch focuses the running window instead, passing on any link.
// The lock is taken before `ready`, so two launches racing from a double click still yield one
// owner; the loser never registers handlers or opens a window while it exits.
const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);

protocol.registerSchemesAsPrivileged([
  {
    scheme,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/** A `<scheme>://pair…` link the OS handed this app (argv on Windows/Linux, open-url on macOS). */
const linkFrom = (argv) => argv.find((arg) => arg.startsWith(`${scheme}://pair`)) ?? null;
let pendingLink = linkFrom(process.argv);

/** The main window (not a popped-out session): links and re-launches land here. */
let mainWindow = null;
/** Popped-out session windows by host and session id. */
const sessionWindows = new Map();

function deliverLink(url) {
  const window = mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (!window) {
    pendingLink = url;
    return;
  }
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (url) window.webContents.send("frogg-next:open-url", url);
}

app.on("second-instance", (_event, argv) => deliverLink(linkFrom(argv)));
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (app.isReady()) deliverLink(url);
  else pendingLink = url;
});

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

/** Runs a kept menu accelerator (Windows/Linux have no menu bar to carry them). */
function runAccelerator(window, action) {
  const contents = window.webContents;
  if (action === "fullscreen") window.setFullScreen(!window.isFullScreen());
  else if (action === "reload") contents.reload();
  else if (action === "devtools") contents.toggleDevTools();
  else if (action === "zoomIn") contents.setZoomLevel(contents.getZoomLevel() + 0.5);
  else if (action === "zoomOut") contents.setZoomLevel(contents.getZoomLevel() - 0.5);
  else if (action === "zoomReset") contents.setZoomLevel(0);
}

function createWindow({ route = {}, size = { width: 1440, height: 960 } } = {}) {
  const window = new BrowserWindow({
    title: identity.name,
    ...size,
    minWidth: route.popout ? 480 : 800,
    minHeight: route.popout ? 400 : 600,
    backgroundColor: "#080b0d",
    ...windowChromeOptions(process.platform),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
      // Direct LAN/tailnet daemons use ws://, matching the prototype's Android client.
      allowRunningInsecureContent: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const destination = new URL(url);
    if (destination.protocol === `${scheme}:` && destination.host === "app") return;
    event.preventDefault();
    openExternal(url);
  });
  if (process.platform !== "darwin") {
    window.webContents.on("before-input-event", (event, input) => {
      const action = acceleratorFor(input);
      if (!action) return;
      event.preventDefault();
      runAccelerator(window, action);
    });
  }
  // `chrome` tells the UI to draw its title bar strip (drag region, room for the controls).
  // `daemon` is only where to look for this machine's daemon; nothing connects without pairing.
  const query = new URLSearchParams({
    daemon: identity.defaultDaemon,
    chrome: chromeMode(process.platform),
    ...route,
  });
  if (!route.popout) {
    if (pendingLink) query.set("pair", pendingLink);
    pendingLink = null;
  }
  void window.loadURL(`${scheme}://app/?${query}`);
  return window;
}

function createMainWindow() {
  mainWindow = createWindow();
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/** Pops a session out into its own window, or focuses the one already showing it. */
function openSessionWindow(input) {
  const request = parseSessionWindowRequest(input);
  if (!request) return false;
  const key = sessionWindowKey(request);
  const open = sessionWindows.get(key);
  if (open && !open.isDestroyed()) {
    if (open.isMinimized()) open.restore();
    open.focus();
    return true;
  }
  const window = createWindow({
    route: sessionWindowQuery(request),
    size: { width: 900, height: 820 },
  });
  sessionWindows.set(key, window);
  window.on("closed", () => sessionWindows.delete(key));
  return true;
}

app.whenReady().then(() => {
  if (!primary) return null;
  // macOS keeps its app menu (Edit carries copy/paste there); elsewhere the bar is gone.
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  const root = path.join(__dirname, "web");
  if (app.isPackaged) app.setAsDefaultProtocolClient(scheme);
  protocol.handle(scheme, (request) => {
    const asset = resolveAsset(root, request.url);
    return asset
      ? net.fetch(pathToFileURL(asset).href)
      : new Response("Not found", { status: 404 });
  });
  // The window shows as soon as it exists (index.html paints a splash before the UI bundle
  // parses), so a click on the taskbar or Start menu gets an answer at once.
  createMainWindow();
  createUpdater(identity);
  ipcMain.handle("frogg-next:open-session-window", (_event, request) => openSessionWindow(request));
  app.on("activate", () => {
    if (!mainWindow) createMainWindow();
  });
  return null;
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
