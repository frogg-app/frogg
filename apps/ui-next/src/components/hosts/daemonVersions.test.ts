import { describe, expect, it } from "vitest";
import { compareVersions, daemonVersions, isDaemonBundle, type Release } from "./daemonVersions";

const bundle = (tag: string) => `frogg-${tag.slice(1)}-linux-x86_64-daemon.tar.gz`;
const rel = (tag: string, prerelease = false, assets = [bundle(tag)], draft = false) =>
  ({ tag_name: tag, prerelease, draft, assets: assets.map((name) => ({ name })) }) as Release;

describe("daemon versions", () => {
  const releases = [
    rel("v1.6.13"),
    rel("v1.6.14-beta.2", true),
    rel("v1.6.14-beta.10", true),
    rel("v1.6.12"),
    rel("v1.6.15-beta.1", true, [bundle("v1.6.15-beta.1")], true),
    rel("v1.6.11", false, ["Frogg-Next-1.6.11.apk"]),
    // The retired beta identity's daemon: not installable by this one.
    rel("v1.6.13-beta.5", true, ["frogg-beta-daemon-1.6.13-beta.5-linux-x64.tar.gz"]),
  ];
  it("lists stable releases on the stable channel, newest first", () => {
    expect(daemonVersions(releases, "stable").map((v) => v.version)).toEqual(["1.6.13", "1.6.12"]);
  });
  it("adds prereleases on beta, never drafts or releases without a daemon", () => {
    expect(daemonVersions(releases, "beta").map((v) => v.version)).toEqual([
      "1.6.14-beta.10",
      "1.6.14-beta.2",
      "1.6.13",
      "1.6.12",
    ]);
  });
  it("orders a prerelease below its release", () => {
    expect(compareVersions("1.6.14", "1.6.14-beta.9")).toBeGreaterThan(0);
    expect(compareVersions("1.6.14-beta.10", "1.6.14-beta.9")).toBeGreaterThan(0);
    expect(compareVersions("1.6.9", "1.6.10")).toBeLessThan(0);
  });
  it("recognises this brand's daemon bundles only", () => {
    expect(isDaemonBundle("frogg-1.6.11-linux-x86_64-daemon.tar.gz", "1.6.11")).toBe(true);
    expect(isDaemonBundle("frogg-1.6.11-win-x64-daemon.zip", "1.6.11")).toBe(true);
    expect(isDaemonBundle("frogg-daemon-0.2.15-linux-x64.tar.gz", "0.2.15")).toBe(true);
    expect(isDaemonBundle("frogg-1.6.11-linux-x86_64-daemon.tar.gz.sha256", "1.6.11")).toBe(false);
    expect(
      isDaemonBundle("frogg-beta-daemon-1.6.13-beta.5-linux-x64.tar.gz", "1.6.13-beta.5"),
    ).toBe(false);
    expect(isDaemonBundle("frogg-1.6.11-linux-x86_64.AppImage", "1.6.11")).toBe(false);
  });
});
