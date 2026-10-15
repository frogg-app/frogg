import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daemonArtifactName,
  desktopArtifactName,
  desktopArtifactSuffixes,
  froggNextArtifactName,
  froggNextChecksumsName,
  froggNextFeedNames,
  isFroggNextArtifact,
  legacyDesktopSuffix,
} from "../../packages/branding/src/artifact-contract.mjs";
const official = {
  legacyFrogg: true,
  artifactPrefix: "Frogg",
  daemonArtifactPrefix: "frogg-daemon",
};
const custom = {
  legacyFrogg: false,
  artifactPrefix: "Atlas",
  daemonArtifactPrefix: "atlas-runtime",
};

test("Frogg consumers retain historical release names and use the new platform convention", () => {
  assert.equal(
    daemonArtifactName(official, "0.2.15", "darwin", "x64"),
    "frogg-daemon-0.2.15-darwin-x64.tar.gz",
  );
  assert.equal(
    daemonArtifactName(official, "0.2.16", "darwin", "x64"),
    "Frogg-0.2.16-mac-x86_64-daemon.tar.gz",
  );
  assert.equal(
    daemonArtifactName(official, "1.2.3", "win", "arm64"),
    "Frogg-1.2.3-win-arm64-daemon.zip",
  );
  assert.equal(
    desktopArtifactName(official, "0.2.15+build", "linux-x86_64.deb"),
    "Frogg-0.2.15+build-amd64.deb",
  );
  assert.equal(
    desktopArtifactName(official, "0.2.16-beta.1", "win-x64-setup.zip"),
    "Frogg-0.2.16-beta.1-win-x64-setup.zip",
  );
  assert.equal(legacyDesktopSuffix("mac-aarch64.app.tar.gz.sig"), "aarch64.app.tar.gz.sig");
});

test("custom distribution overrides never turn into Frogg artifact names", () => {
  for (const version of ["0.2.15", "1.2.3"]) {
    assert.equal(
      daemonArtifactName(custom, version, "linux", "x64"),
      `atlas-runtime-${version}-linux-x64.tar.gz`,
    );
    assert.equal(
      desktopArtifactName(custom, version, "linux-x86_64.deb"),
      `Atlas-${version}-linux-x86_64.deb`,
    );
  }
});

test("generated installer and application agree on the historical cutoff", async () => {
  const { readFile } = await import("node:fs/promises");
  const { execFileSync } = await import("node:child_process");
  const source = await readFile(new URL("../../deploy/install.sh", import.meta.url), "utf8");
  const helper = source.slice(
    source.indexOf("brand_legacy_artifact_version()"),
    source.indexOf("acquire_bundle()"),
  );
  const versions = [
    "0.1.99",
    "0.2.15",
    "0.2.15+build",
    "0.2.16-beta.1",
    "0.2.16",
    "0.3.0",
    "1.0.0",
    "invalid",
  ];
  const result = execFileSync(
    "bash",
    [
      "-c",
      `${helper}\nfor version in "$@"; do if brand_legacy_artifact_version "$version"; then echo old; else echo current; fi; done`,
      "artifact-test",
      ...versions,
    ],
    {
      env: { ...process.env, BRAND_LEGACY_ARTIFACT_CUTOFF: "0.2.16" },
      encoding: "utf8",
    },
  );
  assert.deepEqual(result.trim().split("\n"), [
    "old",
    "old",
    "old",
    "current",
    "current",
    "current",
    "current",
    "current",
  ]);
});

test("Frogg Next is a separate, non-updater asset family", () => {
  const version = "1.6.13-beta.5";
  const next = [
    froggNextArtifactName(version, "mac-arm64.dmg"),
    froggNextArtifactName(version, "mac-arm64.zip"),
    froggNextArtifactName(version, "win-x64.exe"),
    froggNextArtifactName(version, "win-x64.zip"),
    froggNextArtifactName(version, "SHA256SUMS"),
    froggNextArtifactName(version, "android-arm64-v8a-unsigned.apk"),
  ];
  assert.equal(next[0], "Frogg-Next-1.6.13-beta.5-mac-arm64.dmg");
  assert.ok(next.every(isFroggNextArtifact));
  // No classic name of any brand or channel falls into the family, and the classic app's
  // updaters match on an exact `artifactPrefix`, which "Frogg-Next" never is.
  const brands = [official, { ...official, artifactPrefix: "frogg" }, custom];
  for (const brand of brands) {
    assert.notEqual(brand.artifactPrefix, "Frogg-Next");
    for (const suffix of desktopArtifactSuffixes) {
      assert.equal(isFroggNextArtifact(desktopArtifactName(brand, version, suffix)), false);
    }
    assert.equal(isFroggNextArtifact(daemonArtifactName(brand, version, "win", "x64")), false);
  }
  for (const name of ["SHA256SUMS-desktop", "release.json", "electron-latest.yml", "install.sh"]) {
    assert.equal(isFroggNextArtifact(name), false);
  }
  // Feeds never collide with the classic app's electron-latest*.yml / electron-beta*.yml.
  assert.deepEqual(froggNextFeedNames(), [
    "frogg-next-latest.yml",
    "frogg-next-latest-mac.yml",
    "frogg-next-latest-linux.yml",
  ]);
  assert.ok(froggNextFeedNames().every((name) => !name.startsWith("electron-")));
  assert.equal(froggNextChecksumsName(version), "Frogg-Next-1.6.13-beta.5-SHA256SUMS");
  // A fork's own Frogg Next identity.
  assert.equal(
    froggNextArtifactName(version, "win-x64.exe", "acme-next"),
    "acme-next-1.6.13-beta.5-win-x64.exe",
  );
  assert.equal(isFroggNextArtifact("acme-next-1.0.0-win-x64.exe", "acme-next"), true);
  assert.deepEqual(froggNextFeedNames("acme-next")[0], "acme-next-latest.yml");
});
