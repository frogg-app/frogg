const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { resolveAsset } = require("./resolve-asset.cjs");

test("serves bundled assets and SPA routes without exposing files outside the export", () => {
  const root = mkdtempSync(path.join(tmpdir(), "frogg-next-assets-"));
  try {
    writeFileSync(path.join(root, "index.html"), "prototype");
    writeFileSync(path.join(root, "app.js"), "bundle");
    assert.equal(resolveAsset(root, "frogg-next://app/"), path.join(root, "index.html"));
    assert.equal(resolveAsset(root, "frogg-next://app/app.js"), path.join(root, "app.js"));
    assert.equal(resolveAsset(root, "frogg-next://app/settings"), path.join(root, "index.html"));
    for (const url of [
      "frogg-next://app/missing.js",
      "frogg-next://other/app.js",
      "https://app/app.js",
      "frogg-next://app/%2e%2e%2fsecret",
      "frogg-next://app/%5csecret",
      "frogg-next://app/%00",
      "frogg-next://app/%broken",
    ]) {
      assert.equal(resolveAsset(root, url), null, url);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
