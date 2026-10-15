const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_IDENTITY, feedFileNames, resolveIdentity } = require("./identity.cjs");
const { downloadAsset, isNewer, selectRelease, updateMode } = require("./update-feed.cjs");

const identity = resolveIdentity(null);
const release = (
  tag,
  { prerelease = true, feeds = Object.values(feedFileNames(identity)), draft = false } = {},
) => ({
  tag_name: tag,
  prerelease,
  draft,
  html_url: `https://github.com/frogg-app/frogg/releases/tag/${tag}`,
  assets: [
    ...feeds.map((name) => ({ name, browser_download_url: `https://x/${name}` })),
    ...["mac-arm64.dmg", "mac-x64.dmg", "linux-x86_64.deb"].map((suffix) => {
      const name = `Frogg-Next-${tag.slice(1)}-${suffix}`;
      return { name, browser_download_url: `https://x/${name}` };
    }),
  ],
});

test("the identity falls back to Frogg Next per key and takes the brand's next block", () => {
  assert.deepEqual(resolveIdentity(null), DEFAULT_IDENTITY);
  const promoted = resolveIdentity({
    daemonPort: 9999,
    distribution: { repository: "acme/frogg" },
    next: { name: "Frogg", applicationId: "app.frogg.frogg", scheme: "frogg", feedPrefix: "" },
  });
  assert.equal(promoted.name, "Frogg");
  assert.equal(promoted.scheme, "frogg");
  assert.equal(promoted.feedPrefix, "frogg-next");
  assert.equal(promoted.repository, "acme/frogg");
  assert.equal(promoted.artifactPrefix, "Frogg-Next");
  assert.deepEqual(feedFileNames(identity), {
    win32: "frogg-next-latest.yml",
    darwin: "frogg-next-latest-mac.yml",
    linux: "frogg-next-latest-linux.yml",
  });
});

test("a prerelease build follows the newest prerelease that carries its platform's feed", () => {
  const releases = [
    release("v1.6.15", { prerelease: false }),
    release("v1.6.14-beta.3", { feeds: ["frogg-next-latest-mac.yml"] }),
    release("v1.6.14-beta.2"),
    release("v1.6.14-beta.4", { draft: true }),
    release("v1.6.14-beta.1"),
  ];
  const picked = selectRelease(releases, {
    identity,
    platform: "win32",
    currentVersion: "1.6.14-beta.1",
  });
  assert.equal(picked.version, "1.6.14-beta.2");
  assert.equal(
    picked.feedUrl,
    "https://github.com/frogg-app/frogg/releases/download/v1.6.14-beta.2",
  );
  const mac = selectRelease(releases, {
    identity,
    platform: "darwin",
    currentVersion: "1.6.14-beta.1",
  });
  assert.equal(mac.version, "1.6.14-beta.3");
  const stable = selectRelease(releases, { identity, platform: "linux", currentVersion: "1.6.14" });
  assert.equal(stable.version, "1.6.15");
});

test("Windows and AppImage install in place; Mac and deb offer the download", () => {
  assert.equal(updateMode({ platform: "win32", isPackaged: true }), "install");
  assert.equal(updateMode({ platform: "linux", isPackaged: true, isAppImage: true }), "install");
  assert.equal(updateMode({ platform: "linux", isPackaged: true, isAppImage: false }), "download");
  assert.equal(updateMode({ platform: "darwin", isPackaged: true }), "download");
  assert.equal(updateMode({ platform: "win32", isPackaged: false }), "disabled");
  const picked = selectRelease([release("v1.6.14-beta.2")], {
    identity,
    platform: "darwin",
    currentVersion: "1.6.14-beta.1",
  });
  assert.equal(
    downloadAsset(picked, { identity, platform: "darwin", arch: "x64" }),
    "https://x/Frogg-Next-1.6.14-beta.2-mac-x64.dmg",
  );
  assert.equal(
    downloadAsset(picked, { identity, platform: "linux", arch: "x64" }),
    "https://x/Frogg-Next-1.6.14-beta.2-linux-x86_64.deb",
  );
  assert.equal(isNewer("1.6.14-beta.2", "1.6.14-beta.1"), true);
  assert.equal(isNewer("1.6.14-beta.1", "1.6.14-beta.1"), false);
});
