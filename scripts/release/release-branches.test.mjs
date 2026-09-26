import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBranchForMode,
  assertStableBelowBeta,
  requiredBranchForMode,
  requiredBranchForVersion,
} from "./release-branches.mjs";

test("routes stable modes to main and beta modes to beta", () => {
  for (const mode of ["patch", "minor", "major", "promote"]) {
    assert.equal(requiredBranchForMode(mode), "main");
  }
  for (const mode of ["beta-patch", "beta-minor", "beta-major", "beta-next"]) {
    assert.equal(requiredBranchForMode(mode), "beta");
  }
  assert.throws(() => requiredBranchForMode("nope"), /Unknown release mode/);
});

test("routes versions by prerelease suffix", () => {
  assert.equal(requiredBranchForVersion("1.5.46"), "main");
  assert.equal(requiredBranchForVersion("1.6.0-beta.2"), "beta");
});

test("refuses a mode on the wrong branch", () => {
  assert.doesNotThrow(() => assertBranchForMode("patch", "main"));
  assert.throws(() => assertBranchForMode("patch", "beta"), /cut from main.*on beta/);
  assert.throws(() => assertBranchForMode("beta-next", "main"), /cut from beta.*on main/);
  assert.throws(() => assertBranchForMode("patch", "feat/x"), /cut from main/);
});

test("keeps stable strictly below the beta line", () => {
  assert.doesNotThrow(() => assertStableBelowBeta("1.5.46", "1.6.0-beta.2"));
  assert.doesNotThrow(() => assertStableBelowBeta("1.6.0", null));
  assert.throws(() => assertStableBelowBeta("1.6.0", "1.6.0-beta.2"), /would reach beta 1\.6\.0/);
  assert.throws(() => assertStableBelowBeta("2.0.0", "1.6.0-beta.2"), /would reach beta/);
});
