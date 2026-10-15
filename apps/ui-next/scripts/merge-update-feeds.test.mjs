import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { mergeFeed, mergeUpdateFeeds, toYaml } from "./merge-update-feeds.mjs";

const yaml = createRequire(import.meta.url)("js-yaml");

const fragment = (arch, extra = {}) => ({
  version: "1.6.14-beta.2",
  files: [{ url: `Frogg-Next-1.6.14-beta.2-mac-${arch}.zip`, sha512: arch, size: 1 }],
  path: `Frogg-Next-1.6.14-beta.2-mac-${arch}.zip`,
  sha512: arch,
  releaseDate: "2026-10-15T00:00:00.000Z",
  ...extra,
});

test("the Mac arm64 and x64 fragments merge into one feed listing both zips", () => {
  const merged = mergeFeed("frogg-next-latest-mac.yml", [fragment("arm64"), fragment("x64")]);
  assert.deepEqual(
    merged.files.map((f) => f.url),
    ["Frogg-Next-1.6.14-beta.2-mac-arm64.zip", "Frogg-Next-1.6.14-beta.2-mac-x64.zip"],
  );
  assert.equal(merged.version, "1.6.14-beta.2");
});

test("fragments of different versions are refused", () => {
  assert.throws(
    () => mergeFeed("f.yml", [fragment("arm64"), fragment("x64", { version: "1.6.14-beta.1" })]),
    /disagree on version/,
  );
});

test("a directory of fragments becomes the feed files and the fragments go", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "feeds-"));
  writeFileSync(
    path.join(dir, "frogg-next-latest-mac.yml.darwin-arm64.feed.json"),
    JSON.stringify(fragment("arm64")),
  );
  writeFileSync(
    path.join(dir, "frogg-next-latest-mac.yml.darwin-x64.feed.json"),
    JSON.stringify(fragment("x64")),
  );
  writeFileSync(
    path.join(dir, "frogg-next-latest.yml.win32-x64.feed.json"),
    JSON.stringify(fragment("win")),
  );
  assert.deepEqual(mergeUpdateFeeds(dir), ["frogg-next-latest-mac.yml", "frogg-next-latest.yml"]);
  assert.deepEqual(readdirSync(dir).sort(), ["frogg-next-latest-mac.yml", "frogg-next-latest.yml"]);
  const text = readFileSync(path.join(dir, "frogg-next-latest-mac.yml"), "utf8");
  assert.match(text, /^ {2}- url: Frogg-Next-1\.6\.14-beta\.2-mac-arm64\.zip$/m);
  assert.match(text, /^path: Frogg-Next-1\.6\.14-beta\.2-mac-arm64\.zip$/m);
  assert.equal(yaml.load(text).files.length, 2);
});

test("the YAML reads back as the same feed, quotes included", () => {
  const feed = mergeFeed("f.yml", [
    fragment("arm64", { releaseNotes: "it's here", stagingPercentage: 50, flag: "yes" }),
    fragment("x64"),
  ]);
  assert.deepEqual(yaml.load(toYaml(feed)), feed);
});
