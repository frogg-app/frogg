import { i18n } from "@/i18n/i18next";
import type { ReleaseChannel } from "@/hooks/use-settings";
import type { AndroidApkInstallResult } from "@/mobile/updates/android-app-installer";
import type {
  MobileAppUpdateCheckResult,
  MobileUpdateAsset,
} from "@/mobile/updates/mobile-updates";

export type MobileAppUpdateStatus =
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "installing"
  | "installed"
  | "error";

export interface MobileUpdateProgress {
  received: number;
  total: number | null;
}

export interface MobileAppUpdaterSnapshot {
  status: MobileAppUpdateStatus;
  availableUpdate: MobileAppUpdateCheckResult | null;
  errorMessage: string | null;
  noticeMessage: string | null;
  lastCheckedAt: number | null;
  progress: MobileUpdateProgress | null;
  isChecking: boolean;
  isBusy: boolean;
}

export interface MobileAppUpdaterPort {
  check(input: { channel: ReleaseChannel }): Promise<MobileAppUpdateCheckResult>;
  /** Downloads the APK and resolves with the local file path. */
  download(
    asset: MobileUpdateAsset,
    onProgress: (progress: MobileUpdateProgress) => void,
  ): Promise<string>;
  install(path: string): Promise<AndroidApkInstallResult>;
}

export interface MobileAppUpdaterDeps {
  port: MobileAppUpdaterPort;
  now(): number;
}

export interface MobileAppUpdater {
  getSnapshot(): MobileAppUpdaterSnapshot;
  subscribe(listener: () => void): () => void;
  checkForUpdates(options: {
    channel: ReleaseChannel;
    silent?: boolean;
  }): Promise<MobileAppUpdateCheckResult | null>;
  downloadAndInstall(): Promise<AndroidApkInstallResult | null>;
}

const INITIAL_SNAPSHOT: MobileAppUpdaterSnapshot = {
  status: "idle",
  availableUpdate: null,
  errorMessage: null,
  noticeMessage: null,
  lastCheckedAt: null,
  progress: null,
  isChecking: false,
  isBusy: false,
};

function withDerived(snapshot: MobileAppUpdaterSnapshot): MobileAppUpdaterSnapshot {
  return {
    ...snapshot,
    isChecking: snapshot.status === "checking",
    isBusy: snapshot.status === "downloading" || snapshot.status === "installing",
  };
}

function errorMessageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  const text = String(error);
  return text === "[object Object]" ? i18n.t("mobile.updates.status.failed") : text;
}

/** The section prints when it last checked on its own line; this is state only. */
export function formatMobileStatusText(input: {
  status: MobileAppUpdateStatus;
  availableUpdate: MobileAppUpdateCheckResult | null;
  formatVersion: (version: string | null | undefined) => string;
}): string {
  const { status, availableUpdate } = input;

  if (status === "checking") return i18n.t("mobile.updates.status.checking");
  if (status === "downloading") return i18n.t("mobile.updates.status.downloading");
  if (status === "installing") return i18n.t("mobile.updates.status.installing");
  if (status === "installed") return i18n.t("mobile.updates.status.installed");
  if (status === "error") return i18n.t("mobile.updates.status.failed");
  if (status === "up-to-date") return i18n.t("mobile.updates.status.upToDate");
  if (status === "available") {
    return i18n.t("mobile.updates.status.available", {
      version: input.formatVersion(availableUpdate?.latestVersion),
    });
  }
  return i18n.t("mobile.updates.status.idle");
}

export function createMobileAppUpdater(deps: MobileAppUpdaterDeps): MobileAppUpdater {
  let snapshot = withDerived(INITIAL_SNAPSHOT);
  const listeners = new Set<() => void>();
  let checkVersion = 0;

  function commit(update: Partial<MobileAppUpdaterSnapshot>): void {
    snapshot = withDerived({ ...snapshot, ...update });
    for (const listener of listeners) listener();
  }

  async function checkForUpdates(options: {
    channel: ReleaseChannel;
    silent?: boolean;
  }): Promise<MobileAppUpdateCheckResult | null> {
    if (snapshot.status === "downloading" || snapshot.status === "installing") {
      return null;
    }
    const request = ++checkVersion;
    commit({ status: "checking", errorMessage: null, noticeMessage: null });
    try {
      const result = await deps.port.check({ channel: options.channel });
      if (request !== checkVersion) return result;
      commit({
        status: result.hasUpdate ? "available" : "up-to-date",
        availableUpdate: result.hasUpdate ? result : null,
        lastCheckedAt: result.checkedAt,
      });
      return result;
    } catch (error) {
      if (request !== checkVersion) return null;
      // A silent background check must not replace the screen with an error.
      commit(
        options.silent
          ? { status: "idle", lastCheckedAt: deps.now() }
          : {
              status: "error",
              errorMessage: i18n.t("mobile.updates.checkFailed", {
                message: errorMessageOf(error),
              }),
              lastCheckedAt: deps.now(),
            },
      );
      return null;
    }
  }

  async function downloadAndInstall(): Promise<AndroidApkInstallResult | null> {
    const asset = snapshot.availableUpdate?.asset ?? null;
    if (!asset || snapshot.isBusy) return null;

    commit({
      status: "downloading",
      errorMessage: null,
      noticeMessage: null,
      progress: { received: 0, total: asset.size || null },
    });
    let path: string;
    try {
      path = await deps.port.download(asset, (progress) => {
        if (snapshot.status === "downloading") commit({ progress });
      });
    } catch (error) {
      commit({
        status: "error",
        progress: null,
        errorMessage: i18n.t("mobile.updates.downloadFailed", {
          message: errorMessageOf(error),
        }),
      });
      return null;
    }

    commit({ status: "installing", progress: null });
    try {
      const result = await deps.port.install(path);
      if (result.status === "success") {
        commit({ status: "installed" });
      } else if (result.status === "cancelled") {
        commit({ status: "available", noticeMessage: i18n.t("mobile.updates.installCancelled") });
      } else if (result.status === "permission-required") {
        commit({
          status: "available",
          noticeMessage: i18n.t("mobile.updates.permissionRequired"),
        });
      } else {
        commit({
          status: "error",
          errorMessage: result.message
            ? i18n.t("mobile.updates.installFailed", { message: result.message })
            : i18n.t("mobile.updates.status.failed"),
        });
      }
      return result;
    } catch (error) {
      commit({
        status: "error",
        errorMessage: i18n.t("mobile.updates.installFailed", {
          message: errorMessageOf(error),
        }),
      });
      return null;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    checkForUpdates,
    downloadAndInstall,
  };
}
