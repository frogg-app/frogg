// Desktop app updates: finds the newest release for this install's channel on GitHub, then lets
// electron-updater (generic provider, pointed at that release) download it in the background
// and asks to restart. Installs that can't swap themselves in (Mac ad-hoc, .deb) offer the
// installer for download instead. The renderer drives it over the preload bridge.
const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { feedFileNames } = require("./identity.cjs");
const { downloadAsset, isNewer, selectRelease, updateMode } = require("./update-feed.cjs");

const STATE_EVENT = "frogg-next:update-state";
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

function createUpdater(identity) {
  const mode = updateMode({
    platform: process.platform,
    isPackaged: app.isPackaged,
    isAppImage: Boolean(process.env.APPIMAGE),
  });
  let state = {
    mode,
    status: mode === "disabled" ? "disabled" : "idle",
    currentVersion: app.getVersion(),
    latestVersion: null,
    releaseUrl: `https://github.com/${identity.repository}/releases`,
    downloadUrl: null,
    progress: null,
    error: null,
    checkedAt: null,
  };
  let prompted = null;

  function set(patch) {
    state = { ...state, ...patch };
    for (const window of BrowserWindow.getAllWindows())
      if (!window.isDestroyed()) window.webContents.send(STATE_EVENT, state);
  }

  async function latestRelease() {
    const response = await fetch(
      `https://api.github.com/repos/${identity.repository}/releases?per_page=30`,
      { headers: { Accept: "application/vnd.github+json" } },
    );
    if (response.status === 403 || response.status === 429)
      throw new Error("GitHub is rate-limiting update checks. Try again later.");
    if (!response.ok) throw new Error(`GitHub releases answered HTTP ${response.status}`);
    const releases = await response.json();
    return selectRelease(Array.isArray(releases) ? releases : [], {
      identity,
      platform: process.platform,
      currentVersion: app.getVersion(),
    });
  }

  // Only installs that update in place touch electron-updater (on a Mac it would wire up Squirrel).
  if (mode === "install") {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    autoUpdater.on("download-progress", (p) =>
      set({
        status: "downloading",
        progress: { percent: p.percent, transferred: p.transferred, total: p.total },
      }),
    );
    autoUpdater.on("update-downloaded", (info) => {
      set({ status: "ready", progress: null, latestVersion: info.version });
      void promptRestart(info.version);
    });
    autoUpdater.on("error", (error) =>
      set({ status: "error", progress: null, error: error?.message ?? String(error) }),
    );
  }

  async function promptRestart(version) {
    if (prompted === version) return;
    prompted = version;
    const [window] = BrowserWindow.getAllWindows();
    const options = {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      message: `${identity.name} ${version} is ready`,
      detail: "Restart to finish updating. Otherwise it installs the next time you quit.",
    };
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (response === 0) install();
  }

  async function check() {
    if (mode === "disabled") return state;
    if (state.status === "checking" || state.status === "downloading") return state;
    if (state.status === "ready") return state;
    set({ status: "checking", error: null });
    try {
      const release = await latestRelease();
      if (!release || !isNewer(release.version, app.getVersion())) {
        set({
          status: "up-to-date",
          latestVersion: release?.version ?? null,
          checkedAt: Date.now(),
        });
        return state;
      }
      set({ latestVersion: release.version, releaseUrl: release.releaseUrl ?? state.releaseUrl });
      if (mode === "download") {
        set({
          status: "available",
          downloadUrl:
            downloadAsset(release, { identity, platform: process.platform, arch: process.arch }) ??
            release.releaseUrl,
          checkedAt: Date.now(),
        });
        return state;
      }
      autoUpdater.setFeedURL({ provider: "generic", url: release.feedUrl });
      // `<channel>.yml` on Windows, `<channel>-linux.yml` on Linux.
      autoUpdater.channel = feedFileNames(identity).win32.replace(/\.yml$/, "");
      // The channel setter turns downgrades back on.
      autoUpdater.allowDowngrade = false;
      set({ status: "available", checkedAt: Date.now() });
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) set({ status: "up-to-date" });
    } catch (error) {
      set({ status: "error", progress: null, error: error?.message ?? String(error) });
    }
    return state;
  }

  function install() {
    if (state.status !== "ready") return;
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  }

  function download() {
    if (mode === "download" && state.downloadUrl) void shell.openExternal(state.downloadUrl);
  }

  ipcMain.handle("frogg-next:update-get", () => state);
  ipcMain.handle("frogg-next:update-check", () => check());
  ipcMain.handle("frogg-next:update-download", () => download());
  ipcMain.handle("frogg-next:update-install", () => install());

  if (mode !== "disabled") {
    setTimeout(() => void check(), FIRST_CHECK_MS).unref?.();
    setInterval(() => void check(), CHECK_EVERY_MS).unref?.();
  }
  return { check, getState: () => state };
}

module.exports = { createUpdater };
