import assert from "node:assert/strict";
import test from "node:test";
import { isStableVersion, artifactVersion } from "../../packages/protocol/dist/release-version.js";
import { channelOfVersion, parseChannelVersion, releaseLineOfVersion } from "./release-channel.mjs";

const CASES = [
  ["1.6.0", "stable"],
  ["1.6.0-beta.2", "beta"],
  ["1.8.0-rc.1", "beta"],
  ["1.8.0-acme.2", "stable"],
  ["1.8.0-beta.3.acme.1", "beta"],
  ["1.8.0-rc.1.acme.2", "beta"],
  ["1.8.0-acme.1.beta.1", "stable"],
  ["v1.8.0-nightly.4", "beta"],
];

test("the scripts' channel rule matches the updaters' (release-version.ts)", () => {
  for (const [version, channel] of CASES) {
    assert.equal(channelOfVersion(version), channel, version);
    assert.equal(isStableVersion(version), channel === "stable", version);
  }
});

test("splits a version into core, channel part and build counter", () => {
  assert.deepEqual(parseChannelVersion("1.8.0-rc.1.acme.2"), {
    version: "1.8.0-rc.1.acme.2",
    major: 1,
    minor: 8,
    patch: 0,
    core: "1.8.0",
    upstream: "rc.1",
    downstream: "acme.2",
  });
  assert.equal(parseChannelVersion("1.8"), null);
  assert.throws(() => channelOfVersion("nope"), /Not a release version/);
  // Artifact names drop the build counter and keep the channel part.
  assert.equal(artifactVersion("1.8.0-rc.1.acme.2"), "1.8.0-rc.1");
});

test("prereleases split into the frogg beta and Frogg Next lines", () => {
  for (const [version, line] of [
    ["1.8.0", "stable"],
    ["1.8.0-acme.2", "stable"],
    ["1.8.0-beta.3", "beta"],
    ["1.8.0-rc.1.acme.1", "beta"],
    ["1.8.0-next.1", "next"],
    ["v1.8.0-next.2.acme.1", "next"],
    ["1.8.0-acme.1.next.1", "stable"],
  ])
    assert.equal(releaseLineOfVersion(version), line, version);
  assert.throws(() => releaseLineOfVersion("nope"), /Not a release version/);
});
