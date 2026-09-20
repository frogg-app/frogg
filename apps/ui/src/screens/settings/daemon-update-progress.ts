import type { TFunction } from "i18next";
import type { DaemonUpdateRun } from "@frogg/protocol/messages";
import type { RunState } from "./host-daemon-update-state";

/**
 * Presentation for a running daemon self-update: how far the download has got,
 * which phase the daemon is in, and how long the app will keep waiting for the
 * daemon to check back in after it restarts. Pure so it can be unit tested
 * without rendering the settings screen.
 */

/** Phases a current daemon reports; anything else falls back to its message. */
const KNOWN_PHASES = new Set(["check", "download", "verify", "install", "restart", "health_check"]);

const UNITS = ["B", "KiB", "MiB", "GiB"] as const;

export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(decimals)} ${UNITS[unit]}`;
}

/** 0..1 for a download with a known content length, else null (indeterminate). */
export function downloadFraction(run: DaemonUpdateRun | null): number | null {
  if (!run || run.phase !== "download") return null;
  const { receivedBytes, totalBytes } = run;
  if (typeof receivedBytes !== "number" || typeof totalBytes !== "number" || totalBytes <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, receivedBytes / totalBytes));
}

/** mm:ss for a countdown; never negative. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The download line: bytes and percent when known, byte count when not. */
export function describeDownload(run: DaemonUpdateRun, t: TFunction): string | null {
  const received = run.receivedBytes;
  if (typeof received !== "number") return null;
  const fraction = downloadFraction(run);
  if (fraction === null) {
    return t("settings.host.daemon.selfUpdate.progress.downloadedUnknownTotal", {
      received: formatBytes(received),
    });
  }
  return t("settings.host.daemon.selfUpdate.progress.downloaded", {
    received: formatBytes(received),
    total: formatBytes(run.totalBytes as number),
    percent: Math.round(fraction * 100),
  });
}

/** The one-line status under the version row for the current run state. */
export function describeRunState(run: RunState, t: TFunction): string | null {
  if (run.kind === "starting") return t("settings.host.daemon.selfUpdate.phases.check");
  if (run.kind === "reconnecting") return t("settings.host.daemon.selfUpdate.reconnecting");
  if (run.kind !== "running") return null;
  if (run.run.phase === "download") {
    return describeDownload(run.run, t) ?? t("settings.host.daemon.selfUpdate.phases.download");
  }
  if (KNOWN_PHASES.has(run.run.phase)) {
    return t(`settings.host.daemon.selfUpdate.phases.${run.run.phase}`);
  }
  return run.run.message ?? run.run.phase;
}

/** Short label for the update button while a run is in flight. */
export function describeRunButton(run: RunState, t: TFunction): string | null {
  if (run.kind === "starting") return t("settings.host.daemon.selfUpdate.phases.check");
  if (run.kind === "reconnecting") return t("settings.host.daemon.selfUpdate.buttonReconnecting");
  if (run.kind !== "running") return null;
  if (run.run.phase === "download") {
    const fraction = downloadFraction(run.run);
    return fraction === null
      ? t("settings.host.daemon.selfUpdate.phases.download")
      : t("settings.host.daemon.selfUpdate.buttonDownloading", {
          percent: Math.round(fraction * 100),
        });
  }
  if (KNOWN_PHASES.has(run.run.phase)) {
    return t(`settings.host.daemon.selfUpdate.phases.${run.run.phase}`);
  }
  return run.run.message ?? run.run.phase;
}
