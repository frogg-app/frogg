import { describe, expect, it } from "vitest";
import { brand } from "@frogg/branding";
import {
  compareReleaseVersions,
  parseApkAssetName,
  resolveMobileAppUpdate,
  selectApkAsset,
  selectRelease,
  type GithubRelease,
  type GithubReleaseAsset,
} from "./mobile-updates";

const prefix = brand.artifactPrefix;

function asset(name: string, size = 100): GithubReleaseAsset {
  return { name, browser_download_url: `https://example.test/${name}`, size };
}

function release(version: string, assets: GithubReleaseAsset[] = []): GithubRelease {
  return {
    tag_name: `v${version}`,
    body: `notes for ${version}`,
    html_url: `https://example.test/releases/${version}`,
    prerelease: version.includes("-beta."),
    published_at: "2026-09-01T00:00:00Z",
    assets,
  };
}

const device = {
  supportedAbis: ["arm64-v8a", "armeabi-v7a"],
  debugSigned: true,
  packageName: "sh.frogg.app",
};

describe("compareReleaseVersions", () => {
  it("orders patch, minor and major numerically", () => {
    expect(compareReleaseVersions("1.5.18", "1.5.9")).toBe(1);
    expect(compareReleaseVersions("1.6.0", "1.5.99")).toBe(1);
    expect(compareReleaseVersions("2.0.0", "10.0.0")).toBe(-1);
  });

  it("ranks a release above its own betas", () => {
    expect(compareReleaseVersions("1.6.0", "1.6.0-beta.9")).toBe(1);
    expect(compareReleaseVersions("1.6.0-beta.2", "1.6.0-beta.10")).toBe(-1);
    expect(compareReleaseVersions("1.6.0", "1.6.0")).toBe(0);
  });
});

describe("parseApkAssetName", () => {
  it("reads the ABI and signing flavour", () => {
    expect(parseApkAssetName(`${prefix}-1.5.17-android-arm64-v8a.apk`)).toEqual({
      version: "1.5.17",
      abi: "arm64-v8a",
      development: false,
      debugSigned: false,
    });
    expect(parseApkAssetName(`${prefix}-1.5.17-android-arm64-v8a-unsigned.apk`)?.debugSigned).toBe(
      true,
    );
    expect(
      parseApkAssetName(`${prefix}-1.5.17-android-x86_64-development-unsigned.apk`)?.development,
    ).toBe(true);
  });

  it("rejects debug builds, other products and non-APK assets", () => {
    expect(parseApkAssetName(`${prefix}-1.5.17-android-arm64-v8a-debug.apk`)).toBeNull();
    expect(parseApkAssetName(`other-1.5.17-android-arm64-v8a.apk`)).toBeNull();
    expect(parseApkAssetName(`${prefix}-1.5.17-linux-x86_64.AppImage`)).toBeNull();
  });
});

describe("selectApkAsset", () => {
  it("prefers the first device ABI that has a build", () => {
    const selection = selectApkAsset(
      [
        asset(`${prefix}-1.5.18-android-armeabi-v7a-unsigned.apk`),
        asset(`${prefix}-1.5.18-android-arm64-v8a-unsigned.apk`),
      ],
      device,
    );
    expect(selection.asset?.abi).toBe("arm64-v8a");
  });

  it("falls back to the universal build", () => {
    const selection = selectApkAsset(
      [asset(`${prefix}-1.5.18-android-universal-unsigned.apk`)],
      device,
    );
    expect(selection.asset?.abi).toBe("universal");
  });

  it("reports a signing mismatch instead of offering an install Android would reject", () => {
    const selection = selectApkAsset([asset(`${prefix}-1.5.18-android-arm64-v8a.apk`)], device);
    expect(selection).toEqual({ asset: null, signatureMismatch: true });
  });

  it("matches the development build to the .debug application id", () => {
    const assets = [
      asset(`${prefix}-1.5.18-android-arm64-v8a-unsigned.apk`),
      asset(`${prefix}-1.5.18-android-arm64-v8a-development-unsigned.apk`),
    ];
    expect(
      selectApkAsset(assets, { ...device, packageName: "sh.frogg.app.debug" }).asset?.name,
    ).toBe(`${prefix}-1.5.18-android-arm64-v8a-development-unsigned.apk`);
    expect(selectApkAsset(assets, device).asset?.name).toBe(
      `${prefix}-1.5.18-android-arm64-v8a-unsigned.apk`,
    );
  });
});

describe("selectRelease", () => {
  const releases = [release("1.5.17"), release("1.6.0-beta.1"), release("1.5.16")];

  it("keeps betas out of the stable channel", () => {
    expect(selectRelease(releases, "stable")?.tag_name).toBe("v1.5.17");
  });

  it("offers the newest build on the beta channel", () => {
    expect(selectRelease(releases, "beta")?.tag_name).toBe("v1.6.0-beta.1");
  });

  it("ignores drafts", () => {
    expect(selectRelease([{ ...release("9.9.9"), draft: true }], "stable")).toBeNull();
  });
});

describe("resolveMobileAppUpdate", () => {
  const apk = asset(`${prefix}-1.5.18-android-arm64-v8a-unsigned.apk`, 90_000_000);

  it("offers a newer release with its matching package", () => {
    const result = resolveMobileAppUpdate({
      releases: [release("1.5.18", [apk])],
      channel: "stable",
      currentVersion: "1.5.17",
      installer: device,
      checkedAt: 1000,
    });
    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe("1.5.18");
    expect(result.asset?.name).toBe(apk.name);
    expect(result.notes).toBe("notes for 1.5.18");
    expect(result.checkedAt).toBe(1000);
  });

  it("reports no update when the installed build is current or newer", () => {
    const result = resolveMobileAppUpdate({
      releases: [release("1.5.18", [apk])],
      channel: "stable",
      currentVersion: "1.5.18",
      installer: device,
      checkedAt: 1000,
    });
    expect(result.hasUpdate).toBe(false);
    expect(result.asset).toBeNull();
  });

  it("keeps a newer release without a usable package visible", () => {
    const result = resolveMobileAppUpdate({
      releases: [release("1.5.18", [asset(`${prefix}-1.5.18-android-x86-unsigned.apk`)])],
      channel: "stable",
      currentVersion: "1.5.17",
      installer: device,
      checkedAt: 1000,
    });
    expect(result.hasUpdate).toBe(true);
    expect(result.asset).toBeNull();
    expect(result.signatureMismatch).toBe(false);
    expect(result.releaseUrl).toBe("https://example.test/releases/1.5.18");
  });
});
