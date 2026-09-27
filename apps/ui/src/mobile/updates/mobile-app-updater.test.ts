import { describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { AndroidApkInstallResult } from "./android-app-installer";
import {
  createMobileAppUpdater,
  type MobileAppUpdater,
  type MobileAppUpdaterPort,
} from "./mobile-app-updater";
import type { MobileAppUpdateCheckResult } from "./mobile-updates";

function buildCheckResult(
  overrides: Partial<MobileAppUpdateCheckResult> = {},
): MobileAppUpdateCheckResult {
  return {
    hasUpdate: true,
    currentVersion: "1.5.17",
    latestVersion: "1.5.18",
    notes: "notes",
    releaseUrl: "https://example.test/releases/1.5.18",
    publishedAt: "2026-09-01T00:00:00Z",
    asset: {
      name: "Frogg-1.5.18-android-arm64-v8a-unsigned.apk",
      url: "https://example.test/apk",
      size: 90,
      abi: "arm64-v8a",
      debugSigned: true,
    },
    signatureMismatch: false,
    checkedAt: 1000,
    ...overrides,
  };
}

function createUpdater(port: Partial<MobileAppUpdaterPort> = {}): MobileAppUpdater {
  return createMobileAppUpdater({
    port: {
      check: port.check ?? vi.fn(async () => buildCheckResult()),
      download: port.download ?? vi.fn(async () => "file:///cache/app.apk"),
      install:
        port.install ??
        vi.fn(async (): Promise<AndroidApkInstallResult> => ({ status: "success", message: null })),
    },
    now: () => 2000,
  });
}

describe("mobile app updater — check", () => {
  it("publishes an available update and when it was found", async () => {
    const updater = createUpdater();

    await updater.checkForUpdates({ channel: "stable" });

    const snapshot = updater.getSnapshot();
    expect(snapshot.status).toBe("available");
    expect(snapshot.availableUpdate?.latestVersion).toBe("1.5.18");
    expect(snapshot.lastCheckedAt).toBe(1000);
  });

  it("clears a stale offer when the check comes back up to date", async () => {
    const updater = createUpdater({
      check: vi.fn(async () => buildCheckResult({ hasUpdate: false, asset: null })),
    });

    await updater.checkForUpdates({ channel: "stable" });

    expect(updater.getSnapshot().status).toBe("up-to-date");
    expect(updater.getSnapshot().availableUpdate).toBeNull();
  });

  it("surfaces a failed manual check but leaves a silent one quiet", async () => {
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });

    const manual = createUpdater({ check: failing });
    await manual.checkForUpdates({ channel: "stable" });
    expect(manual.getSnapshot().status).toBe("error");
    expect(manual.getSnapshot().errorMessage).toContain("offline");

    const silent = createUpdater({ check: failing });
    await silent.checkForUpdates({ channel: "stable", silent: true });
    expect(silent.getSnapshot().status).toBe("idle");
    expect(silent.getSnapshot().errorMessage).toBeNull();
  });

  it("drops the offer when told to", async () => {
    const updater = createUpdater();
    await updater.checkForUpdates({ channel: "beta" });
    expect(updater.getSnapshot().availableUpdate).not.toBeNull();

    updater.discardAvailableUpdate();

    expect(updater.getSnapshot()).toMatchObject({ availableUpdate: null, status: "idle" });
  });

  it("ignores a check for the old channel that lands after the offer is dropped", async () => {
    let resolveCheck: (result: MobileAppUpdateCheckResult) => void = () => {};
    const updater = createUpdater({
      check: vi.fn(
        () =>
          new Promise<MobileAppUpdateCheckResult>((resolve) => {
            resolveCheck = resolve;
          }),
      ),
    });
    const pending = updater.checkForUpdates({ channel: "beta" });

    updater.discardAvailableUpdate();
    resolveCheck(buildCheckResult({ latestVersion: "1.6.0-beta.1" }));
    await pending;

    expect(updater.getSnapshot()).toMatchObject({ availableUpdate: null, status: "idle" });
  });
});

describe("mobile app updater — download and install", () => {
  it("reports download progress and hands the file to the installer", async () => {
    const install = vi.fn(
      async (): Promise<AndroidApkInstallResult> => ({
        status: "success",
        message: null,
      }),
    );
    const download = vi.fn(
      async (_asset, onProgress: (p: { received: number; total: number | null }) => void) => {
        onProgress({ received: 45, total: 90 });
        return "file:///cache/app.apk";
      },
    );
    const updater = createUpdater({ download, install });
    await updater.checkForUpdates({ channel: "stable" });

    const progressSeen: (number | null)[] = [];
    updater.subscribe(() => progressSeen.push(updater.getSnapshot().progress?.received ?? null));

    await updater.downloadAndInstall();

    expect(progressSeen).toContain(45);
    expect(install).toHaveBeenCalledWith("file:///cache/app.apk");
    expect(updater.getSnapshot().status).toBe("installed");
  });

  it("returns to the offer when the user declines the system prompt", async () => {
    const updater = createUpdater({
      install: vi.fn(async () => ({ status: "cancelled" as const, message: null })),
    });
    await updater.checkForUpdates({ channel: "stable" });

    await updater.downloadAndInstall();

    expect(updater.getSnapshot().status).toBe("available");
    expect(updater.getSnapshot().noticeMessage).toBe(i18n.t("mobile.updates.installCancelled"));
  });

  it("explains a missing install permission instead of reporting a failure", async () => {
    const updater = createUpdater({
      install: vi.fn(async () => ({ status: "permission-required" as const, message: null })),
    });
    await updater.checkForUpdates({ channel: "stable" });

    await updater.downloadAndInstall();

    expect(updater.getSnapshot().status).toBe("available");
    expect(updater.getSnapshot().noticeMessage).toBe(i18n.t("mobile.updates.permissionRequired"));
  });

  it("reports a failed download without losing the offer", async () => {
    const updater = createUpdater({
      download: vi.fn(async () => {
        throw new Error("connection reset");
      }),
    });
    await updater.checkForUpdates({ channel: "stable" });

    await updater.downloadAndInstall();

    expect(updater.getSnapshot().status).toBe("error");
    expect(updater.getSnapshot().errorMessage).toContain("connection reset");
    expect(updater.getSnapshot().availableUpdate?.latestVersion).toBe("1.5.18");
  });

  it("does nothing without a package to install", async () => {
    const install = vi.fn();
    const updater = createUpdater({
      check: vi.fn(async () => buildCheckResult({ asset: null, signatureMismatch: true })),
      install,
    });
    await updater.checkForUpdates({ channel: "stable" });

    expect(await updater.downloadAndInstall()).toBeNull();
    expect(install).not.toHaveBeenCalled();
  });
});
