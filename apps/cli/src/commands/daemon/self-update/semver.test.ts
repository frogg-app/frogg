import { describe, expect, it } from "vitest";
import * as shared from "@frogg/protocol/release-version";
import {
  artifactVersion,
  compareVersionStrings,
  compareVersions,
  isNewerVersion,
  isStableVersion,
  parseVersion,
} from "./semver.js";

/**
 * The rule itself is specified and tested in
 * `packages/protocol/src/release-version.test.ts`. This file only pins the
 * CLI's long-standing import path to that shared implementation, so the
 * ordering the self-updater relies on cannot silently diverge.
 */
describe("self-update semver re-exports", () => {
  it("re-exports the shared release-version implementation", () => {
    expect(parseVersion).toBe(shared.parseVersion);
    expect(compareVersions).toBe(shared.compareVersions);
    expect(compareVersionStrings).toBe(shared.compareVersionStrings);
    expect(isNewerVersion).toBe(shared.isNewerVersion);
    expect(isStableVersion).toBe(shared.isStableVersion);
    expect(artifactVersion).toBe(shared.artifactVersion);
  });

  it("orders a downstream rebuild above the release it rebuilds", () => {
    expect(isNewerVersion("1.3.5-acme.1", "1.3.5")).toBe(true);
    expect(isNewerVersion("1.3.5", "1.3.5-acme.1")).toBe(false);
    expect(isNewerVersion("1.3.5-acme.2", "1.3.5-acme.1")).toBe(true);
    expect(isNewerVersion("1.3.5", "1.3.5-beta.1")).toBe(true);
    expect(isNewerVersion("1.3.6", "1.3.5-acme.1")).toBe(true);
  });
});
