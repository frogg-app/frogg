import assert from "node:assert/strict";
import test from "node:test";
import {
  branchForVersion,
  channelForBranch,
  resolveStreamsConfig,
  upstreamFollowRef,
} from "./streams-config.mjs";
import {
  assertStablePatch,
  isReleaseCutSubject,
  isVersionOwnedFile,
  nextBetaVersion,
  promotionVersion,
} from "./streams-core.mjs";

test("the first beta opens the next minor above stable", () => {
  assert.equal(
    nextBetaVersion({ developmentVersion: "1.5.52", stableVersion: "1.5.52" }),
    "1.6.0-beta.1",
  );
  assert.equal(nextBetaVersion({ developmentVersion: "1.5.52", stableVersion: null }), "1.6.0-beta.1");
});

test("an open beta line continues", () => {
  assert.equal(
    nextBetaVersion({ developmentVersion: "1.6.0-beta.3", stableVersion: "1.5.60" }),
    "1.6.0-beta.4",
  );
});

test("after a promotion the next beta opens the following minor", () => {
  assert.equal(
    nextBetaVersion({ developmentVersion: "1.6.0-beta.4", stableVersion: "1.6.0" }),
    "1.7.0-beta.1",
  );
  assert.equal(
    nextBetaVersion({ developmentVersion: "1.6.0-beta.4", stableVersion: "1.6.2" }),
    "1.7.0-beta.1",
  );
});

test("--major opens or continues the next major line", () => {
  assert.equal(
    nextBetaVersion({ developmentVersion: "1.6.0-beta.4", stableVersion: "1.5.9", major: true }),
    "2.0.0-beta.1",
  );
  assert.equal(
    nextBetaVersion({ developmentVersion: "2.0.0-beta.1", stableVersion: "1.5.9", major: true }),
    "2.0.0-beta.2",
  );
});

test("a fork starts the upstream line it merged, so its releases carry upstream versions", () => {
  assert.equal(
    nextBetaVersion({
      developmentVersion: "1.6.2",
      stableVersion: "1.6.2",
      upstreamVersion: "1.7.0",
    }),
    "1.7.0-beta.1",
  );
  // Its own open line wins once it has caught up.
  assert.equal(
    nextBetaVersion({
      developmentVersion: "1.7.0-beta.2",
      stableVersion: "1.6.2",
      upstreamVersion: "1.7.0",
    }),
    "1.7.0-beta.3",
  );
  // Upstream behind the fork's stable changes nothing.
  assert.equal(
    nextBetaVersion({
      developmentVersion: "1.7.1",
      stableVersion: "1.7.1",
      upstreamVersion: "1.7.0",
    }),
    "1.8.0-beta.1",
  );
});

test("promotion ships the beta line's version and refuses stale lines", () => {
  assert.equal(
    promotionVersion({ developmentVersion: "1.6.0-beta.4", stableVersion: "1.5.9" }),
    "1.6.0",
  );
  assert.throws(
    () => promotionVersion({ developmentVersion: "1.6.0", stableVersion: "1.5.9" }),
    /not a beta/,
  );
  assert.throws(
    () => promotionVersion({ developmentVersion: "1.6.0-beta.4", stableVersion: "1.6.0" }),
    /nothing to promote/,
  );
});

test("a stable patch stays below the beta line", () => {
  assert.doesNotThrow(() =>
    assertStablePatch({ nextStable: "1.5.10", developmentVersion: "1.6.0-beta.1" }),
  );
  assert.throws(
    () => assertStablePatch({ nextStable: "1.6.0", developmentVersion: "1.6.0-beta.1" }),
    /Promote it instead/,
  );
});

test("version-owned files and release cuts are recognised", () => {
  for (const file of [
    "package.json",
    "apps/ui/package.json",
    "packages/server/package.json",
    "package-lock.json",
    "apps/daemon-rs/Cargo.toml",
    "apps/daemon-rs/Cargo.lock",
    "deploy/nix/npm-deps.hash",
  ]) {
    assert.equal(isVersionOwnedFile(file), true, file);
  }
  assert.equal(isVersionOwnedFile("apps/ui/src/package.json"), false);
  assert.equal(isVersionOwnedFile("brands/frogg/brand.json"), false);
  assert.equal(isReleaseCutSubject("chore(release): cut 1.6.0"), true);
  assert.equal(isReleaseCutSubject("chore(release): promote main 1.6.0-beta.2 to stable"), true);
  assert.equal(isReleaseCutSubject("fix(release): cut fewer assets"), false);
});

test("streams config defaults, fork upstream, and validation", () => {
  const defaults = resolveStreamsConfig(undefined);
  assert.deepEqual(defaults, { development: "main", stable: "stable", upstream: null });
  assert.equal(channelForBranch(defaults, "stable"), "stable");
  assert.equal(channelForBranch(defaults, "main"), "beta");
  assert.equal(channelForBranch(defaults, "feat/x"), "beta");
  assert.equal(branchForVersion(defaults, "v1.6.0-beta.1"), "main");
  assert.equal(branchForVersion(defaults, "v1.6.0"), "stable");

  const fork = resolveStreamsConfig({
    development: "develop",
    stable: "release",
    upstream: { repository: "frogg-app/frogg" },
  });
  assert.deepEqual(fork.upstream, {
    remote: "upstream",
    repository: "frogg-app/frogg",
    development: "main",
    stable: "stable",
    follow: "stable",
  });
  assert.equal(upstreamFollowRef(fork), "upstream/stable");
  assert.equal(
    upstreamFollowRef(resolveStreamsConfig({ upstream: { follow: "development" } })),
    "upstream/main",
  );
  assert.throws(() => resolveStreamsConfig({ development: "x", stable: "x" }), /different/);
  assert.throws(() => resolveStreamsConfig({ stable: "--force" }), /branch name/);
  assert.throws(() => resolveStreamsConfig({ upstream: { follow: "nightly" } }), /follow/);
});
