const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync } = require("node:fs");
const path = require("node:path");
const {
  ENTRY_POINTS,
  PACKAGED_FILES,
  isPackaged,
  missingFromPackage,
  runtimeReferences,
} = require("./packaged-files.cjs");

const source = (file) => readFileSync(path.join(__dirname, file), "utf8");

test("every file the shell opens by __dirname is in electron-builder's files list", () => {
  for (const entry of ENTRY_POINTS) {
    for (const ref of runtimeReferences(source(entry))) {
      if (
        ref.endsWith(".cjs") &&
        readdirSync(__dirname).includes(ref) &&
        !ENTRY_POINTS.includes(ref)
      )
        continue; // bundled
      assert.ok(
        isPackaged(ref) || isPackaged(`${ref}/index.html`),
        `${ref} (from ${entry}) is not packaged`,
      );
    }
  }
});

test("local requires in the shell resolve to files the bundler can inline", () => {
  for (const entry of ENTRY_POINTS)
    for (const ref of runtimeReferences(source(entry)).filter((r) => r.endsWith(".cjs")))
      assert.ok(readdirSync(__dirname).includes(ref), `${entry} requires missing ./${ref}`);
});

test("a package missing a file main.cjs loads is reported (the 1.6.14-beta.1 crash)", () => {
  const files = {
    "main.cjs":
      'require("./window-chrome.cjs"); path.join(__dirname, "identity.json"); path.join(__dirname, "web")',
    "preload.cjs": 'require("electron")',
  };
  const read = (file) => files[file];
  assert.deepEqual(
    missingFromPackage(["main.cjs", "preload.cjs", "identity.json", "web/index.html"], read),
    ["window-chrome.cjs (used by main.cjs)"],
  );
  assert.deepEqual(missingFromPackage(["main.cjs"], read), [
    "preload.cjs",
    "window-chrome.cjs (used by main.cjs)",
    "identity.json (used by main.cjs)",
    "web (used by main.cjs)",
  ]);
  assert.ok(PACKAGED_FILES.includes("identity.json"));
});
