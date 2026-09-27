import { describe, expect, it } from "vitest";
import {
  assertBetaArtifact,
  parseSha256Sums,
  parseWindowsUninstallEntries,
  selectBetaInstallerAsset,
  selectLatestBetaRelease,
  sha256FromReleaseDescriptor,
} from "./release.js";

const asset = (name: string) => ({
  name,
  browser_download_url: `https://github.com/frogg-app/frogg/releases/download/x/${name}`,
  size: 10,
});

describe("selectLatestBetaRelease", () => {
  it("picks the newest published beta and skips drafts, stable and non-version tags", () => {
    const release = selectLatestBetaRelease([
      { tag_name: "v1.7.0-beta.1", draft: true, assets: [] },
      { tag_name: "v1.6.4", draft: false, assets: [] },
      { tag_name: "execution-test-e265800", draft: false, assets: [] },
      { tag_name: "v1.6.2-beta.1", draft: false, assets: [asset("a")] },
      { tag_name: "v1.6.5-beta.2", draft: false, assets: [asset("b")] },
    ]);
    expect(release?.version).toBe("1.6.5-beta.2");
    expect(release?.assets.map((entry) => entry.name)).toEqual(["b"]);
  });

  it("returns null when only drafts are beta", () => {
    expect(selectLatestBetaRelease([{ tag_name: "v1.7.0-beta.1", draft: true }])).toBeNull();
  });
});

describe("selectBetaInstallerAsset", () => {
  const release = {
    tag: "v1.6.5-beta.1",
    version: "1.6.5-beta.1",
    assets: [
      "frogg-beta-1.6.5-beta.1-win-x64.exe",
      "frogg-beta-1.6.5-beta.1-win-x64.exe.blockmap",
      "frogg-beta-1.6.5-beta.1-mac-arm64.dmg",
      "frogg-beta-1.6.5-beta.1-mac-x64.dmg",
      "frogg-beta-1.6.5-beta.1-linux-x86_64.AppImage",
      "frogg-1.6.5-beta.1-win-x64.exe",
    ].map((name) => ({ name, url: `https://x/${name}`, size: 1 })),
  };
  const pick = (platform: string, arch: string) =>
    selectBetaInstallerAsset({
      release,
      artifactPrefix: "frogg-beta",
      platform,
      arch,
    });

  it("maps each runtime to its shipped installer", () => {
    expect(pick("win32", "x64")).toMatchObject({
      name: "frogg-beta-1.6.5-beta.1-win-x64.exe",
      kind: "nsis-exe",
    });
    expect(pick("win32", "arm64")?.name).toBe("frogg-beta-1.6.5-beta.1-win-x64.exe");
    expect(pick("darwin", "arm64")).toMatchObject({
      name: "frogg-beta-1.6.5-beta.1-mac-arm64.dmg",
      kind: "dmg",
    });
    expect(pick("darwin", "x64")?.name).toBe("frogg-beta-1.6.5-beta.1-mac-x64.dmg");
    expect(pick("linux", "x64")).toMatchObject({ kind: "appimage" });
    expect(pick("linux", "arm64")).toBeNull();
    expect(pick("freebsd", "x64")).toBeNull();
  });
});

describe("checksums", () => {
  it("parses sha256sum output", () => {
    const sums = parseSha256Sums(`${"a".repeat(64)}  one.exe\n${"B".repeat(64)} *two.dmg\njunk\n`);
    expect(sums.get("one.exe")).toBe("a".repeat(64));
    expect(sums.get("two.dmg")).toBe("b".repeat(64));
  });

  it("finds a file hash in release.json", () => {
    const raw = {
      updatePaths: {
        x: {
          platforms: {
            "-win": { files: [{ url: "f.exe", sha256: "c".repeat(64) }] },
          },
        },
      },
    };
    expect(sha256FromReleaseDescriptor(raw, "f.exe")).toBe("c".repeat(64));
    expect(sha256FromReleaseDescriptor(raw, "g.exe")).toBeNull();
  });
});

describe("assertBetaArtifact", () => {
  it("rejects stable artifacts and a shared prefix", () => {
    expect(() =>
      assertBetaArtifact({
        assetName: "frogg-1.0.0-win-x64.exe",
        betaArtifactPrefix: "frogg-beta",
        stableArtifactPrefix: "frogg",
      }),
    ).toThrow(/not a beta/);
    expect(() =>
      assertBetaArtifact({
        assetName: "frogg-1.0.0-win-x64.exe",
        betaArtifactPrefix: "frogg",
        stableArtifactPrefix: "frogg",
      }),
    ).toThrow(/share/);
  });
});

describe("parseWindowsUninstallEntries", () => {
  it("reads display name, version and location per key", () => {
    const output = [
      "",
      "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\abc",
      "    DisplayName    REG_SZ    frogg beta 1.6.5-beta.1",
      "    DisplayVersion    REG_SZ    1.6.5-beta.1",
      "    InstallLocation    REG_SZ    C:\\Users\\me\\AppData\\Local\\Programs\\frogg beta",
      "",
      "End of search: 1 match(es) found.",
    ].join("\r\n");
    expect(parseWindowsUninstallEntries(output)).toEqual([
      {
        displayName: "frogg beta 1.6.5-beta.1",
        displayVersion: "1.6.5-beta.1",
        installLocation: "C:\\Users\\me\\AppData\\Local\\Programs\\frogg beta",
      },
    ]);
  });
});
