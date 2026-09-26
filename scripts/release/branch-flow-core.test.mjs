import assert from "node:assert/strict";
import test from "node:test";
import { isVersionOwnedPath, promotionVersion, resolveSyncedVersion } from "./branch-flow-core.mjs";

test("keeps the target branch's version after a sync merge", () => {
  assert.equal(
    resolveSyncedVersion({ targetBranch: "beta", preMergeVersion: "1.6.0-beta.2" }),
    "1.6.0-beta.2",
  );
  assert.equal(resolveSyncedVersion({ targetBranch: "main", preMergeVersion: "1.5.49" }), "1.5.49");
  assert.throws(
    () => resolveSyncedVersion({ targetBranch: "beta", preMergeVersion: "1.5.46" }),
    /beta must carry a -beta\.N version/,
  );
  assert.throws(
    () => resolveSyncedVersion({ targetBranch: "main", preMergeVersion: "1.6.0-beta.1" }),
    /main must carry a stable version/,
  );
});

test("promotes beta to its base version", () => {
  assert.equal(promotionVersion({ betaVersion: "1.6.0-beta.3", mainVersion: "1.5.49" }), "1.6.0");
  assert.throws(
    () => promotionVersion({ betaVersion: "1.6.0", mainVersion: "1.5.49" }),
    /not a beta/,
  );
  assert.throws(
    () => promotionVersion({ betaVersion: "1.5.0-beta.1", mainVersion: "1.5.49" }),
    /not above main/,
  );
});

test("recognises files the version restamp rewrites", () => {
  for (const file of [
    "package.json",
    "apps/ui/package.json",
    "package-lock.json",
    "apps/daemon-rs/Cargo.toml",
    "apps/daemon-rs/Cargo.lock",
    "deploy/nix/npm-deps.hash",
  ]) {
    assert.equal(isVersionOwnedPath(file), true, file);
  }
  assert.equal(isVersionOwnedPath("apps/ui/src/index.ts"), false);
  assert.equal(isVersionOwnedPath("CHANGELOG.md"), false);
});
