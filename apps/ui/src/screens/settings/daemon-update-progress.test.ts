import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { DaemonUpdateRun } from "@frogg/protocol/messages";
import {
  describeRunButton,
  describeRunState,
  downloadFraction,
  formatBytes,
  formatDuration,
} from "./daemon-update-progress";

// The copy itself lives in the locale files; these assertions are about which
// key the state picks and the numbers interpolated into it.
const t = ((key: string, vars?: Record<string, unknown>) =>
  vars ? `${key} ${JSON.stringify(vars)}` : key) as unknown as TFunction;

function run(overrides: Partial<DaemonUpdateRun> = {}): DaemonUpdateRun {
  return {
    runId: "run-1",
    version: "1.5.11",
    phase: "download",
    message: null,
    at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  } as DaemonUpdateRun;
}

describe("formatBytes", () => {
  it("scales to the largest unit that keeps the number short", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(120 * 1024 * 1024)).toBe("120 MiB");
  });

  it("never reports negative bytes", () => {
    expect(formatBytes(-1)).toBe("0 B");
  });
});

describe("formatDuration", () => {
  it("renders mm:ss and floors at zero", () => {
    expect(formatDuration(4 * 60_000)).toBe("4:00");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(-5)).toBe("0:00");
  });
});

describe("downloadFraction", () => {
  it("is the received share of a known total", () => {
    expect(downloadFraction(run({ receivedBytes: 50, totalBytes: 200 }))).toBe(0.25);
  });

  it("is indeterminate without a total, off the download phase, or with no run", () => {
    expect(downloadFraction(run({ receivedBytes: 50, totalBytes: null }))).toBeNull();
    expect(
      downloadFraction(run({ phase: "install", receivedBytes: 50, totalBytes: 200 })),
    ).toBeNull();
    expect(downloadFraction(null)).toBeNull();
  });
});

describe("describeRunState", () => {
  it("names the phase, with byte counts while downloading", () => {
    expect(
      describeRunState({ kind: "running", run: run({ receivedBytes: 1024, totalBytes: 4096 }) }, t),
    ).toBe(
      'settings.host.daemon.selfUpdate.progress.downloaded {"received":"1.0 KiB","total":"4.0 KiB","percent":25}',
    );
    expect(describeRunState({ kind: "running", run: run({ phase: "install" }) }, t)).toBe(
      "settings.host.daemon.selfUpdate.phases.install",
    );
  });

  it("covers the states either side of the run itself", () => {
    expect(describeRunState({ kind: "starting" }, t)).toBe(
      "settings.host.daemon.selfUpdate.phases.check",
    );
    expect(
      describeRunState({ kind: "reconnecting", run: run(), deadline: Date.now() + 1000 }, t),
    ).toBe("settings.host.daemon.selfUpdate.reconnecting");
    expect(describeRunState({ kind: "idle" }, t)).toBeNull();
  });

  // A daemon newer than the app can name a phase this build has no copy for.
  it("falls back to the daemon's own message for an unknown phase", () => {
    expect(
      describeRunState(
        { kind: "running", run: run({ phase: "quarantine", message: "Scanning" }) },
        t,
      ),
    ).toBe("Scanning");
  });
});

describe("describeRunButton", () => {
  it("shows the download percentage, then the wait", () => {
    expect(
      describeRunButton({ kind: "running", run: run({ receivedBytes: 1, totalBytes: 2 }) }, t),
    ).toBe('settings.host.daemon.selfUpdate.buttonDownloading {"percent":50}');
    expect(describeRunButton({ kind: "running", run: run({ totalBytes: null }) }, t)).toBe(
      "settings.host.daemon.selfUpdate.phases.download",
    );
    expect(
      describeRunButton({ kind: "reconnecting", run: run(), deadline: Date.now() + 1000 }, t),
    ).toBe("settings.host.daemon.selfUpdate.buttonReconnecting");
    expect(describeRunButton({ kind: "error", message: "boom" }, t)).toBeNull();
  });
});
