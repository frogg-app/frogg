import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { Directory, File as FSFile, Paths } from "expo-file-system";
import * as LegacyFileSystem from "expo-file-system/legacy";
import { isFdroidBuild } from "@/constants/build-profile";
import { useSettings } from "@/hooks/use-settings";
import { i18n } from "@/i18n/i18next";
import {
  getAndroidInstallerInfo,
  installAndroidApk,
  isAndroidInstallerAvailable,
  type AndroidApkInstallResult,
  type AndroidInstallerInfo,
} from "@/mobile/updates/android-app-installer";
import {
  createMobileAppUpdater,
  formatMobileStatusText,
  type MobileAppUpdater,
  type MobileAppUpdateStatus,
  type MobileUpdateProgress,
} from "@/mobile/updates/mobile-app-updater";
import {
  fetchPublishedReleases,
  resolveMobileAppUpdate,
  RELEASES_API_URL,
  type MobileAppUpdateCheckResult,
  type MobileUpdateAsset,
} from "@/mobile/updates/mobile-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { brand } from "@frogg/branding";

const UPDATE_DOWNLOAD_DIRECTORY = "app-updates";

/**
 * In-app updating is Android-only: the module is not built for iOS (the App
 * Store owns those updates), is left out of F-Droid builds (the F-Droid client
 * owns those), and a brand without published releases has nothing to check.
 */
export function shouldShowMobileUpdates(): boolean {
  return (
    !isFdroidBuild &&
    isAndroidInstallerAvailable() &&
    RELEASES_API_URL !== null &&
    brand.distribution.updateMode !== "disabled"
  );
}

function downloadTargetFile(assetName: string): FSFile {
  const directory = new Directory(Paths.cache, UPDATE_DOWNLOAD_DIRECTORY);
  if (!directory.exists) {
    directory.create({ intermediates: true });
  }
  const target = new FSFile(directory, assetName.replace(/[\\/:*?"<>|]+/g, "_"));
  if (target.exists) {
    // A part-downloaded or superseded APK must never be handed to the installer.
    target.delete();
  }
  return target;
}

async function downloadApk(
  asset: MobileUpdateAsset,
  onProgress: (progress: MobileUpdateProgress) => void,
): Promise<string> {
  const target = downloadTargetFile(asset.name);
  const download = LegacyFileSystem.createDownloadResumable(
    asset.url,
    target.uri,
    undefined,
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      onProgress({
        received: totalBytesWritten,
        total: totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : (asset.size ?? null),
      });
    },
  );
  const result = await download.downloadAsync();
  if (!result?.uri) {
    throw new Error(i18n.t("mobile.updates.downloadCancelled"));
  }
  return result.uri;
}

async function checkForRelease(
  channel: "stable" | "beta",
  installer: AndroidInstallerInfo,
): Promise<MobileAppUpdateCheckResult> {
  const releases = await fetchPublishedReleases();
  return resolveMobileAppUpdate({
    releases,
    channel,
    currentVersion: resolveAppVersion(),
    installer,
    checkedAt: Date.now(),
  });
}

export interface UseMobileAppUpdaterReturn {
  isSupported: boolean;
  status: MobileAppUpdateStatus;
  statusText: string;
  availableUpdate: MobileAppUpdateCheckResult | null;
  errorMessage: string | null;
  noticeMessage: string | null;
  lastCheckedAt: number | null;
  progress: MobileUpdateProgress | null;
  isChecking: boolean;
  isBusy: boolean;
  checkForUpdates: (options?: { silent?: boolean }) => Promise<MobileAppUpdateCheckResult | null>;
  downloadAndInstall: () => Promise<AndroidApkInstallResult | null>;
  /** Drops the current offer; call before switching channel so it cannot linger. */
  discardAvailableUpdate: () => void;
}

// One updater per app run: the settings section and the callout show the same
// check, the same download progress and the same install outcome.
let sharedUpdater: MobileAppUpdater | null = null;

function getSharedUpdater(): MobileAppUpdater {
  sharedUpdater ??= createMobileAppUpdater({
    port: {
      async check(input) {
        const installer = getAndroidInstallerInfo();
        if (!installer) {
          throw new Error(i18n.t("mobile.updates.unsupported"));
        }
        return checkForRelease(input.channel, installer);
      },
      download: downloadApk,
      install: installAndroidApk,
    },
    now: () => Date.now(),
  });
  return sharedUpdater;
}

export function useMobileAppUpdater(): UseMobileAppUpdaterReturn {
  const isSupported = shouldShowMobileUpdates();
  const { settings } = useSettings();
  const channel = settings.mobileUpdateChannel;
  const autoCheck = settings.mobileUpdateAutoCheck;

  const updater = useMemo(() => getSharedUpdater(), []);

  const snapshot = useSyncExternalStore(
    updater.subscribe,
    updater.getSnapshot,
    updater.getSnapshot,
  );

  const checkForUpdates = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!isSupported) return null;
      return updater.checkForUpdates({ channel, silent: options.silent });
    },
    [channel, isSupported, updater],
  );

  const downloadAndInstall = useCallback(async () => {
    if (!isSupported) return null;
    return updater.downloadAndInstall();
  }, [isSupported, updater]);

  const discardAvailableUpdate = useCallback(() => updater.discardAvailableUpdate(), [updater]);

  useEffect(() => {
    if (!isSupported || !autoCheck) return;
    void checkForUpdates({ silent: true });
  }, [autoCheck, checkForUpdates, isSupported]);

  return {
    isSupported,
    status: snapshot.status,
    statusText: formatMobileStatusText({
      status: snapshot.status,
      availableUpdate: snapshot.availableUpdate,
      formatVersion: formatVersionWithPrefix,
    }),
    availableUpdate: snapshot.availableUpdate,
    errorMessage: snapshot.errorMessage,
    noticeMessage: snapshot.noticeMessage,
    lastCheckedAt: snapshot.lastCheckedAt,
    progress: snapshot.progress,
    isChecking: snapshot.isChecking,
    isBusy: snapshot.isBusy,
    checkForUpdates,
    downloadAndInstall,
    discardAvailableUpdate,
  };
}
