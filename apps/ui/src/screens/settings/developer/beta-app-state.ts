import type {
  DesktopBetaAppInstallProgress,
  DesktopBetaAppLatestRelease,
  DesktopBetaAppStatus,
} from "@/desktop/host";

export type BetaAppAction =
  | { kind: "install"; version: string }
  | { kind: "update"; version: string }
  | { kind: "upToDate" }
  | { kind: "none" };

/** What the primary button offers, given the installed beta and the newest published one. */
export function resolveBetaAppAction(
  status: DesktopBetaAppStatus | null,
  latest: DesktopBetaAppLatestRelease | null,
): BetaAppAction {
  if (!status?.supported || !latest) return { kind: "none" };
  if (!status.installed) return { kind: "install", version: latest.version };
  if (status.installedVersion === latest.version) return { kind: "upToDate" };
  return { kind: "update", version: latest.version };
}

export function isBetaAppInstallActive(progress: DesktopBetaAppInstallProgress | null): boolean {
  if (!progress) return false;
  return (
    progress.phase === "resolving" ||
    progress.phase === "downloading" ||
    progress.phase === "verifying" ||
    progress.phase === "installing"
  );
}

/** Download fraction in [0, 1], or null when the size is unknown (indeterminate bar). */
export function betaAppDownloadFraction(progress: DesktopBetaAppInstallProgress): number | null {
  if (progress.phase === "resolving") return 0;
  if (progress.phase !== "downloading") return 1;
  if (!progress.totalBytes || progress.totalBytes <= 0) return null;
  return Math.min(1, Math.max(0, progress.receivedBytes / progress.totalBytes));
}

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
