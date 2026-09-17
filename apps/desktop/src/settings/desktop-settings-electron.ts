import { app } from "electron";
import {
  createDesktopSettingsStore,
  type DesktopSettings,
  type DesktopSettingsStore,
} from "./desktop-settings.js";
import { setDownloadPreferences } from "../features/download-location.js";

let desktopSettingsStore: DesktopSettingsStore | null = null;
export function getDesktopSettingsStore(): DesktopSettingsStore {
  if (desktopSettingsStore) return desktopSettingsStore;
  const store = createDesktopSettingsStore({
    userDataPath: app.getPath("userData"),
    defaultDownloadDirectory: resolveDefaultDownloadDirectory(),
  });
  desktopSettingsStore = {
    async get() {
      return publish(await store.get());
    },
    async patch(value) {
      return publish(await store.patch(value));
    },
    async migrateLegacyRendererSettings(value) {
      return publish(await store.migrateLegacyRendererSettings(value));
    },
  };
  void desktopSettingsStore.get().catch(() => undefined);
  return desktopSettingsStore;
}

function publish(settings: DesktopSettings): DesktopSettings {
  setDownloadPreferences(settings.downloads);
  return settings;
}

/** Linux desktops disagree on a downloads folder, so the home directory is the predictable default. */
export function resolveDefaultDownloadDirectory(): string {
  return process.platform === "linux" ? app.getPath("home") : app.getPath("downloads");
}
