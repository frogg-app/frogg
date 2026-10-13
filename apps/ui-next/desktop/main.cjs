const { app, BrowserWindow, Menu, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { resolveAsset } = require("./resolve-asset.cjs");
const { acceleratorFor, chromeMode, windowChromeOptions } = require("./window-chrome.cjs");

app.setName("Frogg Next");
app.setPath("userData", path.join(app.getPath("appData"), "Frogg Next"));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "frogg-next",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

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

function createWindow() {
  const window = new BrowserWindow({
    title: "Frogg Next",
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#080b0d",
    ...windowChromeOptions(process.platform),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
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
    if (destination.protocol === "frogg-next:" && destination.host === "app") return;
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
  const chrome = chromeMode(process.platform);
  void window.loadURL(`frogg-next://app/?daemon=127.0.0.1:9999&chrome=${chrome}`);
}

app.whenReady().then(() => {
  // macOS keeps its app menu (Edit carries copy/paste there); elsewhere the bar is gone.
  if (process.platform !== "darwin") Menu.setApplicationMenu(null);
  const root = path.join(__dirname, "web");
  protocol.handle("frogg-next", (request) => {
    const asset = resolveAsset(root, request.url);
    return asset
      ? net.fetch(pathToFileURL(asset).href)
      : new Response("Not found", { status: 404 });
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  return null;
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
