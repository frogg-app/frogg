import { describe, expect, it } from "vitest";
import type { DesktopBetaAppStatus } from "@/desktop/host";
import {
  betaAppDownloadFraction,
  isBetaAppInstallActive,
  resolveBetaAppAction,
} from "./beta-app-state";

const status: DesktopBetaAppStatus = {
  supported: true,
  unsupportedReason: null,
  betaName: "frogg beta",
  installed: false,
  installedVersion: null,
  installPath: null,
  installing: false,
};
const latest = {
  version: "1.6.5-beta.3",
  tag: "v1.6.5-beta.3",
  assetName: "a",
  assetSize: 10,
  kind: "appimage",
};

describe("beta app state", () => {
  it("offers install, update or nothing", () => {
    expect(resolveBetaAppAction(status, latest)).toEqual({
      kind: "install",
      version: "1.6.5-beta.3",
    });
    expect(
      resolveBetaAppAction(
        { ...status, installed: true, installedVersion: "1.6.5-beta.1" },
        latest,
      ),
    ).toEqual({ kind: "update", version: "1.6.5-beta.3" });
    expect(
      resolveBetaAppAction(
        { ...status, installed: true, installedVersion: "1.6.5-beta.3" },
        latest,
      ),
    ).toEqual({ kind: "upToDate" });
    expect(resolveBetaAppAction({ ...status, supported: false }, latest)).toEqual({ kind: "none" });
    expect(resolveBetaAppAction(status, null)).toEqual({ kind: "none" });
  });

  it("computes download progress and activity", () => {
    const downloading = {
      phase: "downloading" as const,
      version: "v",
      assetName: "a",
      error: null,
      receivedBytes: 5,
      totalBytes: 10,
    };
    expect(betaAppDownloadFraction(downloading)).toBe(0.5);
    expect(betaAppDownloadFraction({ ...downloading, totalBytes: null })).toBeNull();
    expect(isBetaAppInstallActive(downloading)).toBe(true);
    expect(isBetaAppInstallActive({ ...downloading, phase: "failed" })).toBe(false);
    expect(isBetaAppInstallActive(null)).toBe(false);
  });
});
