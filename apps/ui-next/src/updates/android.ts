import { requireOptionalNativeModule } from "expo";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { create } from "zustand";
import { resolveApkUpdate, type ApkUpdate, type GithubRelease, type InstallerInfo } from "./apk";

const APP_VERSION: string = require("../../package.json").version;
/** Frogg Next's artifact prefix and release repository, from the brand (app.config.js). */
const PREFIX = process.env.EXPO_PUBLIC_FROGG_ARTIFACT_PREFIX?.trim() || "Frogg-Next";
const REPOSITORY = process.env.EXPO_PUBLIC_FROGG_RELEASE_REPO?.trim() || "frogg-app/frogg";
export const RELEASES_PAGE = `https://github.com/${REPOSITORY}/releases`;

type InstallStatus = "success" | "cancelled" | "failure";
interface InstallerModule {
  getInstallerInfo(): InstallerInfo & { canRequestPackageInstalls: boolean; packageName: string };
  openInstallPermissionSettings(): Promise<void>;
  installApk(path: string): Promise<{ status: InstallStatus; message: string | null }>;
}

// The classic app's FroggAppInstaller module (apps/ui/modules, linked through ./modules).
const installer =
  Platform.OS === "android"
    ? requireOptionalNativeModule<InstallerModule>("FroggAppInstaller")
    : null;

export const apkUpdatesSupported = installer !== null;

export interface ApkUpdaterState {
  status: "idle" | "checking" | "up-to-date" | "available" | "downloading" | "installing" | "error";
  update: ApkUpdate | null;
  progress: number | null;
  error: string | null;
  notice: string | null;
  checkedAt: number | null;
}

export const useApkUpdater = create<ApkUpdaterState>(() => ({
  status: "idle",
  update: null,
  progress: null,
  error: null,
  notice: null,
  checkedAt: null,
}));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function checkApkUpdate(): Promise<void> {
  const st = useApkUpdater.getState();
  if (!installer || st.status === "checking" || st.status === "downloading") return;
  useApkUpdater.setState({ status: "checking", error: null, notice: null });
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`,
      {
        headers: { Accept: "application/vnd.github+json" },
      },
    );
    if (!response.ok) throw new Error(`GitHub releases answered HTTP ${response.status}`);
    const releases = (await response.json()) as GithubRelease[];
    const update = resolveApkUpdate({
      releases: Array.isArray(releases) ? releases : [],
      currentVersion: APP_VERSION,
      prefix: PREFIX,
      installer: installer.getInstallerInfo(),
    });
    useApkUpdater.setState({
      status: update.hasUpdate ? "available" : "up-to-date",
      update,
      checkedAt: Date.now(),
    });
  } catch (e) {
    useApkUpdater.setState({ status: "error", error: message(e), checkedAt: Date.now() });
  }
}

/** Downloads the offered APK into the cache and hands it to the system installer. */
export async function installApkUpdate(): Promise<void> {
  const asset = useApkUpdater.getState().update?.asset;
  if (!installer || !asset) return;
  if (!installer.getInstallerInfo().canRequestPackageInstalls) {
    await installer.openInstallPermissionSettings();
    useApkUpdater.setState({
      notice: "Allow this app to install updates, then press Install again.",
    });
    return;
  }
  useApkUpdater.setState({ status: "downloading", progress: 0, error: null, notice: null });
  try {
    const dir = `${FileSystem.cacheDirectory}app-updates/`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
    const target = `${dir}${asset.name.replace(/[\\/:*?"<>|]+/g, "_")}`;
    // A part-downloaded or superseded APK must never reach the installer.
    await FileSystem.deleteAsync(target, { idempotent: true });
    const download = FileSystem.createDownloadResumable(asset.url, target, undefined, (p) => {
      const total = p.totalBytesExpectedToWrite > 0 ? p.totalBytesExpectedToWrite : asset.size;
      useApkUpdater.setState({ progress: total ? p.totalBytesWritten / total : null });
    });
    const result = await download.downloadAsync();
    if (!result?.uri) throw new Error("The download was cancelled");
    useApkUpdater.setState({ status: "installing", progress: null });
    const outcome = await installer.installApk(result.uri);
    useApkUpdater.setState(
      outcome.status === "failure"
        ? { status: "error", error: outcome.message ?? "The install failed" }
        : {
            status: "available",
            notice: outcome.status === "cancelled" ? "Install cancelled." : null,
          },
    );
  } catch (e) {
    useApkUpdater.setState({ status: "error", progress: null, error: message(e) });
  }
}
