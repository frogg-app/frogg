import { requireOptionalNativeModule } from "expo-modules-core";

/** What the device can install, and what the installed build was signed with. */
export interface AndroidInstallerInfo {
  /** Device ABIs, most preferred first (`Build.SUPPORTED_ABIS`). */
  supportedAbis: string[];
  /** "Install unknown apps" is granted for this app. */
  canRequestPackageInstalls: boolean;
  /** The installed build carries the publicly known Android debug certificate. */
  debugSigned: boolean;
  packageName: string;
}

/**
 * `permission-required` is raised by this wrapper, not by the native module: the
 * user has to grant "install unknown apps" before a session can be committed.
 */
export type AndroidApkInstallStatus = "success" | "cancelled" | "failure" | "permission-required";

export interface AndroidApkInstallResult {
  status: AndroidApkInstallStatus;
  message: string | null;
}

interface FroggAppInstallerModule {
  getInstallerInfo(): AndroidInstallerInfo;
  openInstallPermissionSettings(): Promise<void>;
  installApk(path: string): Promise<AndroidApkInstallResult>;
}

// Android-only by its expo-module.config.json, so this is null on iOS, on the
// web, in tests, and in any build that leaves the module out (F-Droid).
const installer = requireOptionalNativeModule<FroggAppInstallerModule>("FroggAppInstaller");

/** The running build can install an APK over itself. */
export function isAndroidInstallerAvailable(): boolean {
  return installer !== null;
}

export function getAndroidInstallerInfo(): AndroidInstallerInfo | null {
  if (!installer) return null;
  try {
    return installer.getInstallerInfo();
  } catch {
    // A device that refuses to report its signing state cannot be matched to an
    // asset; the caller treats that as "no update path" rather than crashing.
    return null;
  }
}

/** Opens the system screen where "install unknown apps" is granted for this app. */
export async function openAndroidInstallPermissionSettings(): Promise<void> {
  if (!installer) return;
  await installer.openInstallPermissionSettings();
}

/**
 * Hands the downloaded APK to the system installer, first sending the user to
 * grant "install unknown apps" if they have not. Resolves once the confirmation
 * has been answered; a successful install stops this process first, so in
 * practice only cancellation and failure come back.
 */
export async function installAndroidApk(path: string): Promise<AndroidApkInstallResult> {
  if (!installer) {
    return { status: "failure", message: null };
  }
  if (getAndroidInstallerInfo()?.canRequestPackageInstalls === false) {
    await openAndroidInstallPermissionSettings();
    return { status: "permission-required", message: null };
  }
  return installer.installApk(path);
}
