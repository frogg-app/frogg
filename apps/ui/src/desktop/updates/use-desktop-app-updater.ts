import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  checkDesktopAppUpdate,
  formatVersionWithPrefix,
  installDesktopAppUpdate,
  listenToDesktopAppUpdateAvailable,
  shouldShowDesktopUpdateSection,
  type DesktopAppUpdateCheckResult,
  type DesktopAppUpdateCheckIntent,
  type DesktopAppUpdateInstallResult,
} from "@/desktop/updates/desktop-updates";
import {
  IDLE_APP_UPDATE_PROGRESS,
  listenToDesktopAppUpdateProgress,
  reduceAppUpdateProgress,
  type AppUpdateProgress,
} from "@/desktop/updates/app-update-progress";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { useDesktopIpcErrorReporter } from "@/desktop/hooks/desktop-ipc-error";
import {
  createDesktopAppUpdater,
  formatStatusText,
  type DesktopAppUpdateStatus,
} from "@/desktop/updates/desktop-app-updater";
import { formatMessageTimestamp } from "@/utils/time";

export type { DesktopAppUpdateStatus };

export interface UseDesktopAppUpdaterReturn {
  isDesktopApp: boolean;
  status: DesktopAppUpdateStatus;
  statusText: string;
  availableUpdate: DesktopAppUpdateCheckResult | null;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  isChecking: boolean;
  isInstalling: boolean;
  /** Download / verify / install progress reported by the shell, including the background download. */
  progress: AppUpdateProgress;
  checkForUpdates: (options?: {
    intent?: DesktopAppUpdateCheckIntent;
    silent?: boolean;
  }) => Promise<DesktopAppUpdateCheckResult | null>;
  installUpdate: () => Promise<DesktopAppUpdateInstallResult | null>;
}

export function useDesktopAppUpdater(): UseDesktopAppUpdaterReturn {
  const isDesktopApp = shouldShowDesktopUpdateSection();
  const { settings: desktopSettings } = useDesktopSettings();
  const releaseChannel = desktopSettings.releaseChannel;
  const reportError = useDesktopIpcErrorReporter();
  const [progress, setProgress] = useState<AppUpdateProgress>(IDLE_APP_UPDATE_PROGRESS);

  const updater = useMemo(
    () =>
      createDesktopAppUpdater({
        port: {
          checkDesktopAppUpdate,
          async installDesktopAppUpdate(input) {
            // The updater publishes installing before entering this port, so
            // the bar shows immediately even before the first progress event.
            setProgress((current) =>
              current.status === "active"
                ? current
                : {
                    status: "active",
                    phase: "download",
                    received: 0,
                    total: null,
                  },
            );
            try {
              return await installDesktopAppUpdate(input);
            } finally {
              setProgress((current) =>
                current.status === "error" ? current : IDLE_APP_UPDATE_PROGRESS,
              );
            }
          },
        },
        now: () => Date.now(),
        reportInstallError: reportError,
      }),
    [reportError],
  );

  const snapshot = useSyncExternalStore(
    updater.subscribe,
    updater.getSnapshot,
    updater.getSnapshot,
  );

  const checkForUpdates = useCallback(
    async (options: { intent?: DesktopAppUpdateCheckIntent; silent?: boolean } = {}) => {
      if (!isDesktopApp) {
        return null;
      }
      return updater.checkForUpdates({
        releaseChannel,
        intent: options.intent ?? "manual",
        silent: options.silent,
      });
    },
    [isDesktopApp, releaseChannel, updater],
  );

  const installUpdate = useCallback(async () => {
    if (!isDesktopApp) return null;
    return updater.installUpdate({ releaseChannel });
  }, [isDesktopApp, releaseChannel, updater]);

  useEffect(() => {
    if (!isDesktopApp) {
      return;
    }
    void checkForUpdates({ intent: "automatic", silent: true });
  }, [checkForUpdates, isDesktopApp]);

  // The shell reports download progress for the background download as well as
  // for an explicit install, so listen for as long as the section is mounted.
  useEffect(() => {
    if (!isDesktopApp) {
      return undefined;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listenToDesktopAppUpdateProgress((event) => {
      setProgress((current) => reduceAppUpdateProgress(current, event));
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
        return;
      })
      .catch(() => {
        // Progress is optional; the ready event still enables the button.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isDesktopApp]);

  // Once the download lands the bar has nothing left to show.
  const readyToInstall = snapshot.availableUpdate?.readyToInstall ?? false;
  useEffect(() => {
    if (readyToInstall && !snapshot.isInstalling) {
      setProgress((current) => (current.status === "active" ? IDLE_APP_UPDATE_PROGRESS : current));
    }
  }, [readyToInstall, snapshot.isInstalling]);

  // Fresh shell checks announce a newer version here. The automatic re-check
  // reads the cache without emitting again and refreshes local state.
  useEffect(() => {
    if (!isDesktopApp) {
      return undefined;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    listenToDesktopAppUpdateAvailable(() => {
      void checkForUpdates({ intent: "automatic", silent: true });
    })
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
        return;
      })
      .catch(() => {
        // Hosts without events still support the mount check and manual checks.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [checkForUpdates, isDesktopApp]);

  return {
    isDesktopApp,
    status: snapshot.status,
    statusText: formatStatusText({
      status: snapshot.status,
      availableUpdate: snapshot.availableUpdate,
      installMessage: snapshot.installMessage,
      lastCheckedAt: snapshot.lastCheckedAt,
      formatVersion: formatVersionWithPrefix,
      formatLastCheckedAt: (timestamp) => formatMessageTimestamp(new Date(timestamp)),
    }),
    availableUpdate: snapshot.availableUpdate,
    errorMessage: snapshot.errorMessage,
    lastCheckedAt: snapshot.lastCheckedAt,
    isChecking: snapshot.isChecking,
    isInstalling: snapshot.isInstalling,
    progress,
    checkForUpdates,
    installUpdate,
  };
}
