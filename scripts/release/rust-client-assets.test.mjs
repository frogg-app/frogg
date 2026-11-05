import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildRustClientFeed, planRustClientAssets } from "./rust-client-assets.mjs";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "rust-client-assets.mjs");
const V = "1.6.14-next.5";

test("bundles and their signatures get platform release names", () => {
  const plan = planRustClientAssets(
    [
      "linux/bundle/deb/Frogg Next RS_1.6.14_amd64.deb",
      "linux/bundle/appimage/Frogg Next RS_1.6.14_amd64.AppImage",
      "linux/bundle/appimage/Frogg Next RS_1.6.14_amd64.AppImage.sig",
      "win/bundle/nsis/Frogg Next RS_1.6.14_x64-setup.exe",
      "mac/bundle/dmg/Frogg Next RS_1.6.14_aarch64.dmg",
      "mac/bundle/macos/Frogg Next RS.app.tar.gz",
      "android/app-universal-release.apk",
      "android/output-metadata.json",
    ],
    V,
  );
  assert.deepEqual(
    plan.map(({ name }) => name),
    [
      `Frogg-Next-RS-${V}-android-universal.apk`,
      `Frogg-Next-RS-${V}-linux-x64.AppImage`,
      `Frogg-Next-RS-${V}-linux-x64.AppImage.sig`,
      `Frogg-Next-RS-${V}-linux-x64.deb`,
      `Frogg-Next-RS-${V}-macos-arm64.app.tar.gz`,
      `Frogg-Next-RS-${V}-macos-arm64.dmg`,
      `Frogg-Next-RS-${V}-windows-x64.exe`,
    ],
  );
  assert.throws(() => planRustClientAssets(["a/x.deb", "b/y.deb"], V), /Two bundles/);
});

test("the feed lists only signed updater bundles, under Tauri's platform keys", () => {
  const names = [`Frogg-Next-RS-${V}-linux-x64.AppImage`, `Frogg-Next-RS-${V}-windows-x64.exe`];
  const feed = buildRustClientFeed({
    version: V,
    names,
    signatures: { [`Frogg-Next-RS-${V}-linux-x64.AppImage.sig`]: "c2ln\n" },
    repo: "frogg-app/frogg",
    tag: `v${V}`,
    pubDate: "2026-11-05T00:00:00.000Z",
  });
  assert.equal(feed.version, V);
  assert.equal(feed.pub_date, "2026-11-05T00:00:00.000Z");
  assert.deepEqual(Object.keys(feed.platforms), ["linux-x86_64", "linux-x86_64-appimage"]);
  assert.deepEqual(feed.platforms["linux-x86_64"], {
    signature: "c2ln",
    url: `https://github.com/frogg-app/frogg/releases/download/v${V}/Frogg-Next-RS-${V}-linux-x64.AppImage`,
  });
  assert.equal(
    buildRustClientFeed({ version: V, names, signatures: {}, repo: "r/r", tag: "t", pubDate: "" }),
    null,
  );
});

test("the CLI copies, checksums and writes a feed only when signed", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rs-assets-"));
  try {
    const input = path.join(dir, "in");
    mkdirSync(path.join(input, "nsis"), { recursive: true });
    writeFileSync(path.join(input, "nsis", "setup.exe"), "exe");
    writeFileSync(path.join(input, "x.deb"), "deb");
    const run = (out) =>
      execFileSync(process.execPath, [script, "--in", input, "--out", out, "--version", V]);
    run(path.join(dir, "unsigned"));
    assert.deepEqual(readdirSync(path.join(dir, "unsigned")).sort(), [
      `Frogg-Next-RS-${V}-SHA256SUMS`,
      `Frogg-Next-RS-${V}-linux-x64.deb`,
      `Frogg-Next-RS-${V}-windows-x64.exe`,
    ]);
    const sums = readFileSync(path.join(dir, "unsigned", `Frogg-Next-RS-${V}-SHA256SUMS`), "utf8");
    assert.match(sums, new RegExp(`^[a-f0-9]{64}  Frogg-Next-RS-${V}-linux-x64\\.deb$`, "m"));

    writeFileSync(path.join(input, "nsis", "setup.exe.sig"), "sig");
    run(path.join(dir, "signed"));
    const feed = JSON.parse(readFileSync(path.join(dir, "signed", "frogg-next-rs-latest.json")));
    assert.deepEqual(Object.keys(feed.platforms), ["windows-x86_64", "windows-x86_64-nsis"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
