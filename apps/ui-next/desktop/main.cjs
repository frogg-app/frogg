const { app, BrowserWindow, net, protocol, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { resolveAsset } = require("./resolve-asset.cjs");

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

function createWindow() {
  const window = new BrowserWindow({
    title: "Frogg Next",
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#080b0d",
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
  void window.loadURL("frogg-next://app/?daemon=127.0.0.1:9999");
}

app.whenReady().then(() => {
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
