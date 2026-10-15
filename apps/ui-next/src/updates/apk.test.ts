import { describe, expect, it } from "vitest";
import { resolveApkUpdate, type GithubRelease } from "./apk";

const apk = (version: string, suffix = "android-arm64-v8a.apk", prefix = "Frogg-Next") => ({
  name: `${prefix}-${version}-${suffix}`,
  browser_download_url: `https://x/${prefix}-${version}-${suffix}`,
  size: 10,
});
const release = (tag: string, assets = [apk(tag.slice(1))], prerelease = true): GithubRelease => ({
  tag_name: tag,
  prerelease,
  assets,
  html_url: `https://github.com/frogg-app/frogg/releases/tag/${tag}`,
});
const installer = { supportedAbis: ["arm64-v8a"], debugSigned: false };

describe("resolveApkUpdate", () => {
  it("offers the newest prerelease's Frogg Next APK and ignores stable releases and classic APKs", () => {
    const update = resolveApkUpdate({
      releases: [
        release("v1.6.15", [apk("1.6.15", "android-arm64-v8a.apk", "frogg")], false),
        release("v1.6.14-beta.3"),
        release("v1.6.14-beta.2"),
      ],
      currentVersion: "1.6.14-beta.1",
      prefix: "Frogg-Next",
      installer,
    });
    expect(update.hasUpdate).toBe(true);
    expect(update.latestVersion).toBe("1.6.14-beta.3");
    expect(update.asset?.name).toBe("Frogg-Next-1.6.14-beta.3-android-arm64-v8a.apk");
  });

  it("reports a signing mismatch instead of offering an APK Android would refuse", () => {
    const update = resolveApkUpdate({
      releases: [
        release("v1.6.14-beta.2", [apk("1.6.14-beta.2", "android-arm64-v8a-unsigned.apk")]),
      ],
      currentVersion: "1.6.14-beta.1",
      prefix: "Frogg-Next",
      installer,
    });
    expect(update.asset).toBeNull();
    expect(update.signatureMismatch).toBe(true);
  });

  it("is up to date on the newest prerelease", () => {
    const update = resolveApkUpdate({
      releases: [release("v1.6.14-beta.1")],
      currentVersion: "1.6.14-beta.1",
      prefix: "Frogg-Next",
      installer,
    });
    expect(update.hasUpdate).toBe(false);
  });
});
