import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { verifyReleaseAssets, verifyReleasePayloads } from "./verify-release-assets.mjs";
import { buildReleaseMetadata } from "./build-release-metadata.mjs";

test("Electron manifests require every platform and carry real hashes for both Mac architectures", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-update-manifest-"));
  const out = path.join(dir, "metadata");
  try {
    await assert.rejects(buildReleaseMetadata({ version: "0.6.0", assets: dir, out }), /Expected/);
    for (const suffix of ["win-x64.exe", "linux-x86_64.AppImage", "mac-x64.zip", "mac-arm64.zip"]) {
      await writeFile(path.join(dir, `Frogg-0.6.0-${suffix}`), suffix);
    }
    await buildReleaseMetadata({ version: "0.6.0", assets: dir, out });
    const descriptor = JSON.parse(await readFile(path.join(out, "release.json"), "utf8"));
    assert.equal(descriptor.schemaVersion, 1);
    assert.equal(Object.hasOwn(descriptor, "runtime"), false);
    assert.equal(descriptor.channel, "stable");
    assert.equal(descriptor.version, "0.6.0");
    assert.equal(descriptor.updatePaths["tauri-updater"].mode, "manual");
    for (const platform of Object.values(descriptor.updatePaths["electron-updater"].platforms)) {
      const channel = JSON.parse(await readFile(path.join(out, platform.manifest), "utf8"));
      assert.deepEqual(platform.files, channel.files);
      for (const file of platform.files)
        assert.equal((await readFile(path.join(dir, file.url))).length, file.size);
    }
    const manifests = {};
    const assets = [{ name: "release.json" }];
    for (const platform of Object.values(descriptor.updatePaths["electron-updater"].platforms)) {
      manifests[platform.manifest] = JSON.parse(
        await readFile(path.join(out, platform.manifest), "utf8"),
      );
      assets.push({ name: platform.manifest });
      for (const file of platform.files) {
        const bytes = await readFile(path.join(dir, file.url));
        assets.push({
          name: file.url,
          size: bytes.length,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        });
      }
    }
    const release = { tag_name: "v0.6.0", assets };
    verifyReleaseAssets({ descriptor, manifests, release });
    const previousDescriptor = { updatePaths: { "future-updater": { mode: "automatic" } } };
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests, release, previousDescriptor }),
      /Missing upgrade path/,
    );
    const migrating = structuredClone(descriptor);
    migrating.updatePaths["future-updater"] = {
      mode: "manual",
      message: "Install the replacement package manually.",
    };
    verifyReleaseAssets({ descriptor: migrating, manifests, release, previousDescriptor });
    const unknownAutomatic = structuredClone(migrating);
    unknownAutomatic.updatePaths["future-updater"] = { mode: "automatic" };
    assert.throws(
      () => verifyReleaseAssets({ descriptor: unknownAutomatic, manifests, release }),
      /No publication verifier/,
    );

    await verifyReleasePayloads(descriptor, dir);
    assert.throws(
      () =>
        verifyReleaseAssets({
          descriptor: {
            ...descriptor,
            updatePaths: {
              ...descriptor.updatePaths,
              "electron-updater": {
                ...descriptor.updatePaths["electron-updater"],
                minimumClientVersion: "invalid",
              },
            },
          },
          manifests,
          release,
        }),
      /minimum/,
    );
    const wrongHash = structuredClone(descriptor);
    wrongHash.updatePaths["electron-updater"].platforms["-win"].files[0].sha512 =
      Buffer.alloc(64).toString("base64");
    await assert.rejects(verifyReleasePayloads(wrongHash, dir), /byte verification/);
    for (const changes of [{ name: "renamed.exe" }, { size: 0 }, { digest: "sha256:incorrect" }]) {
      const broken = structuredClone(release);
      const payload = broken.assets.find((asset) => asset.name.endsWith(".exe"));
      Object.assign(payload, changes);
      assert.throws(
        () => verifyReleaseAssets({ descriptor, manifests, release: broken }),
        /Missing payload|mismatch/,
      );
    }
    const brokenManifests = structuredClone(manifests);
    brokenManifests["electron-latest.yml"].files[0].url = "different.exe";
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests: brokenManifests, release }),
      /inconsistent/,
    );
    const manifest = JSON.parse(await readFile(path.join(out, "electron-latest-mac.yml"), "utf8"));
    assert.equal(manifest.version, "0.6.0");
    const linux = JSON.parse(await readFile(path.join(out, "electron-latest-linux.yml"), "utf8"));
    assert.equal(linux.path, "Frogg-0.6.0-linux-x86_64.AppImage");
    assert.equal(linux.files[0].url, linux.path);
    assert.equal(manifest.files.length, 2);
    for (const file of manifest.files) {
      const bytes = await readFile(path.join(dir, file.url));
      assert.equal(file.sha512, createHash("sha512").update(bytes).digest("base64"));
      assert.equal(file.size, bytes.length);
    }
    assert.match(
      await readFile(path.join(out, "SHA256SUMS-desktop"), "utf8"),
      /Frogg-0.6.0-win-x64.exe/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects two Mac payloads for the same architecture", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-mac-coverage-"));
  try {
    for (const name of [
      "Frogg-0.6.0-win-x64.exe",
      "Frogg-0.6.0-linux-x86_64.AppImage",
      "Frogg-0.6.0-mac-x64.zip",
      "Other-0.6.0-mac-x64.zip",
    ]) {
      await writeFile(path.join(dir, name), name);
    }
    await assert.rejects(
      buildReleaseMetadata({
        version: "0.6.0",
        assets: dir,
        out: path.join(dir, "metadata"),
      }),
      /one x64 and one arm64/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("-next prereleases carry Frogg Next and never a classic Electron feed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-next-assets-"));
  const out = path.join(dir, "metadata");
  const version = "1.6.14-next.1";
  try {
    for (const suffix of ["win-x64.exe", "linux-x86_64.AppImage", "mac-x64.zip", "mac-arm64.zip"]) {
      await writeFile(path.join(dir, `Frogg-${version}-${suffix}`), suffix);
    }
    await assert.rejects(
      buildReleaseMetadata({ version, client: "classic", assets: dir, out }),
      /cannot carry the classic client/,
    );
    await assert.rejects(
      buildReleaseMetadata({ version, client: "classic-beta", assets: dir, out }),
      /cannot carry the classic-beta client/,
    );
    for (const other of ["1.6.14", "1.6.14-beta.4"])
      await assert.rejects(
        buildReleaseMetadata({ version: other, client: "frogg-next", out }),
        /cannot carry the frogg-next client/,
      );
    const descriptor = await buildReleaseMetadata({ version, out });
    assert.equal(descriptor.client, "frogg-next");
    assert.equal(descriptor.channel, "beta");
    assert.equal(descriptor.updatePaths["electron-updater"].mode, "manual");
    assert.match(descriptor.updatePaths["electron-updater"].message, /Frogg Next/);
    assert.deepEqual(descriptor.froggNext, {
      artifactPrefix: "Frogg-Next",
      feeds: ["frogg-next-latest.yml", "frogg-next-latest-mac.yml", "frogg-next-latest-linux.yml"],
      checksums: `Frogg-Next-${version}-SHA256SUMS`,
    });
    assert.deepEqual(
      JSON.parse(await readFile(path.join(out, "release.json"), "utf8")),
      descriptor,
    );
    const fork = await buildReleaseMetadata({
      version,
      out,
      next: { name: "Acme Next", artifactPrefix: "acme-next", feedPrefix: "acme-next" },
    });
    assert.equal(fork.froggNext.feeds[0], "acme-next-latest.yml");
    assert.match(fork.updatePaths["electron-updater"].message, /Acme Next/);
    const daemonOnly = await buildReleaseMetadata({ version, client: "none", out });
    assert.equal(Object.hasOwn(daemonOnly, "froggNext"), false);

    const brand = {
      artifactPrefix: "frogg",
      next: { artifactPrefix: "Frogg-Next", feedPrefix: "frogg-next" },
    };
    const payload = `Frogg-Next-${version}-win-x64.exe`;
    const digest = createHash("sha256").update("exe").digest("hex");
    const nextFeeds = {
      "frogg-next-latest.yml": `version: ${version}\nfiles:\n  - url: ${payload}\n    sha512: x\npath: ${payload}\n`,
      "frogg-next-latest-mac.yml": `files:\n  - url: Frogg-Next-${version}-mac-arm64.zip\n`,
      "frogg-next-latest-linux.yml": `files:\n  - url: Frogg-Next-${version}-linux-x86_64.AppImage\n`,
      [descriptor.froggNext.checksums]: `${digest}  ${payload}\n`,
    };
    const assets = [
      "release.json",
      ...Object.keys(nextFeeds),
      `Frogg-Next-${version}-mac-arm64.zip`,
      `Frogg-Next-${version}-linux-x86_64.AppImage`,
      `frogg-${version}-linux-x86_64-daemon.tar.gz`,
      `frogg-${version}-linux-x86_64-daemon.tar.gz.sha256`,
      "install.sh",
    ].map((name) => ({ name }));
    assets.push({ name: payload, digest: `sha256:${digest}` });
    const release = { tag_name: `v${version}`, assets };
    verifyReleaseAssets({ descriptor, manifests: {}, release, brand, nextFeeds });
    const withClassic = (name) => ({ ...release, assets: [...assets, { name }] });
    assert.throws(
      () =>
        verifyReleaseAssets({
          descriptor,
          manifests: {},
          release: withClassic("electron-beta.yml"),
          brand,
          nextFeeds,
        }),
      /Classic update feeds/,
    );
    assert.throws(
      () =>
        verifyReleaseAssets({
          descriptor,
          manifests: {},
          release: withClassic(`Frogg-${version}-win-x64.exe`),
          brand,
          nextFeeds,
        }),
      /Classic app payloads/,
    );
    assert.throws(
      () =>
        verifyReleaseAssets({
          descriptor,
          manifests: {},
          release: withClassic(`frogg-beta-${version}-android-arm64-v8a.apk`),
          brand,
          nextFeeds,
        }),
      /Classic app payloads/,
    );
    const missingFeed = {
      ...release,
      assets: assets.filter((asset) => asset.name !== "frogg-next-latest-mac.yml"),
    };
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests: {}, release: missingFeed, brand }),
      /not uploaded: frogg-next-latest-mac\.yml/,
    );
    const missingPayload = {
      ...release,
      assets: assets.filter((asset) => !asset.name.endsWith("mac-arm64.zip")),
    };
    assert.throws(
      () =>
        verifyReleaseAssets({
          descriptor,
          manifests: {},
          release: missingPayload,
          brand,
          nextFeeds,
        }),
      /names a missing payload/,
    );
    const badSum = structuredClone(release);
    badSum.assets.find((asset) => asset.name === payload).digest = `sha256:${"0".repeat(64)}`;
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests: {}, release: badSum, brand, nextFeeds }),
      /Checksum mismatch/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a stable release carries the classic app and no Frogg Next assets", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-classic-only-"));
  const out = path.join(dir, "metadata");
  try {
    for (const suffix of ["win-x64.exe", "linux-x86_64.AppImage", "mac-x64.zip", "mac-arm64.zip"])
      await writeFile(path.join(dir, `Frogg-1.6.14-${suffix}`), suffix);
    const descriptor = await buildReleaseMetadata({ version: "1.6.14", assets: dir, out });
    assert.equal(descriptor.client, "classic");
    assert.equal(descriptor.updatePaths["electron-updater"].channel, "electron-latest");
    const manifests = {};
    const assets = [{ name: "release.json" }];
    for (const platform of Object.values(descriptor.updatePaths["electron-updater"].platforms)) {
      manifests[platform.manifest] = JSON.parse(
        await readFile(path.join(out, platform.manifest), "utf8"),
      );
      assets.push({ name: platform.manifest });
      for (const file of platform.files)
        assets.push({ name: file.url, size: file.size, digest: `sha256:${file.sha256}` });
    }
    const release = { tag_name: "v1.6.14", assets };
    const brand = {
      artifactPrefix: "frogg",
      next: { artifactPrefix: "Frogg-Next", feedPrefix: "frogg-next" },
    };
    verifyReleaseAssets({ descriptor, manifests, release, brand });
    for (const name of ["Frogg-Next-1.6.14-win-x64.exe", "frogg-next-latest.yml"]) {
      assert.throws(
        () =>
          verifyReleaseAssets({
            descriptor,
            manifests,
            release: { ...release, assets: [...assets, { name }] },
            brand,
          }),
        /Frogg Next assets on a classic release/,
      );
    }
    // A frogg beta feed on a stable release would move a beta install onto stable's payloads.
    assert.throws(
      () =>
        verifyReleaseAssets({
          descriptor,
          manifests,
          release: { ...release, assets: [...assets, { name: "electron-beta.yml" }] },
          brand,
        }),
      /other classic channel on a classic release/,
    );
    // An automatic classic path on a -next prerelease is refused at publication too.
    const next = structuredClone(descriptor);
    next.version = "1.6.14-next.1";
    next.channel = "beta";
    delete next.client;
    assert.throws(
      () =>
        verifyReleaseAssets({
          descriptor: next,
          manifests,
          release: { ...release, tag_name: "v1.6.14-next.1" },
        }),
      /classic Electron feeds are not published/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a -beta release carries frogg beta on electron-beta feeds", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-classic-beta-"));
  const out = path.join(dir, "metadata");
  const version = "1.6.14-beta.4";
  try {
    for (const suffix of ["win-x64.exe", "linux-x86_64.AppImage", "mac-x64.zip", "mac-arm64.zip"])
      await writeFile(path.join(dir, `frogg-beta-${version}-${suffix}`), suffix);
    await assert.rejects(
      buildReleaseMetadata({ version, client: "classic", assets: dir, out }),
      /cannot carry the classic client/,
    );
    const descriptor = await buildReleaseMetadata({ version, assets: dir, out });
    assert.equal(descriptor.client, "classic-beta");
    assert.equal(descriptor.channel, "beta");
    const update = descriptor.updatePaths["electron-updater"];
    assert.equal(update.mode, "automatic");
    assert.equal(update.channel, "electron-beta");
    assert.deepEqual(
      Object.values(update.platforms)
        .map((platform) => platform.manifest)
        .sort(),
      ["electron-beta-linux.yml", "electron-beta-mac.yml", "electron-beta.yml"],
    );
    const manifests = {};
    const assets = [{ name: "release.json" }];
    for (const platform of Object.values(update.platforms)) {
      manifests[platform.manifest] = JSON.parse(
        await readFile(path.join(out, platform.manifest), "utf8"),
      );
      assets.push({ name: platform.manifest });
      for (const file of platform.files)
        assets.push({ name: file.url, size: file.size, digest: `sha256:${file.sha256}` });
    }
    const release = { tag_name: `v${version}`, assets };
    const brand = {
      artifactPrefix: "frogg",
      next: { artifactPrefix: "Frogg-Next", feedPrefix: "frogg-next" },
    };
    verifyReleaseAssets({ descriptor, manifests, release, brand });
    for (const [name, error] of [
      ["electron-latest.yml", /other classic channel on a classic-beta release/],
      ["frogg-next-latest.yml", /Frogg Next assets on a classic-beta release/],
    ])
      assert.throws(
        () =>
          verifyReleaseAssets({
            descriptor,
            manifests,
            release: { ...release, assets: [...assets, { name }] },
            brand,
          }),
        error,
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("selected releases retain exact preceding platform payloads and versions", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "frogg-retained-platforms-"));
  const out = path.join(dir, "metadata");
  try {
    for (const suffix of ["win-x64.exe", "linux-x86_64.AppImage", "mac-x64.zip", "mac-arm64.zip"])
      await writeFile(path.join(dir, `Frogg-0.6.13-${suffix}`), suffix);
    const previousDescriptor = await buildReleaseMetadata({ version: "0.6.13", assets: dir, out });
    await writeFile(path.join(dir, "Frogg-0.6.19-win-x64.exe"), "new installer");
    const descriptor = await buildReleaseMetadata({
      version: "0.6.19",
      assets: dir,
      out,
      platformVersions: { "-linux": "0.6.13", "-mac": "0.6.13" },
    });
    const manifests = {};
    const assets = [{ name: "release.json" }];
    for (const [key, platform] of Object.entries(
      descriptor.updatePaths["electron-updater"].platforms,
    )) {
      const manifest = JSON.parse(await readFile(path.join(out, platform.manifest), "utf8"));
      assert.equal(manifest.version, key === "-win" ? "0.6.19" : "0.6.13");
      manifests[platform.manifest] = manifest;
      assets.push({ name: platform.manifest });
      for (const file of platform.files)
        assets.push({ name: file.url, size: file.size, digest: `sha256:${file.sha256}` });
    }
    const release = { tag_name: "v0.6.19", assets };
    verifyReleaseAssets({ descriptor, manifests, release, previousDescriptor });
    await verifyReleasePayloads(descriptor, dir);
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests, release }),
      /Retained platform/,
    );
    const altered = structuredClone(previousDescriptor);
    altered.updatePaths["electron-updater"].platforms["-linux"].files[0].sha256 = "0".repeat(64);
    assert.throws(
      () => verifyReleaseAssets({ descriptor, manifests, release, previousDescriptor: altered }),
      /Retained platform/,
    );
    await assert.rejects(
      buildReleaseMetadata({
        version: "0.6.19",
        assets: dir,
        out,
        platformVersions: { "-linux": "0.6.20" },
      }),
      /Invalid retained/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
