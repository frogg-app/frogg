import { describe, expect, it } from "vitest";
import {
  artifactVersion,
  compareVersionStrings,
  isNewerVersion,
  isSameUpstreamRelease,
  isStableVersion,
  parseVersion,
} from "./release-version.js";

/**
 * Ordering rule under test:
 *   1.3.5-beta.1 < 1.3.5-beta.2 < 1.3.5 < 1.3.5-acme.1 < 1.3.5-acme.2 < 1.3.6
 * A downstream rebuild suffix sorts ABOVE the release it rebuilds; a known
 * upstream channel suffix keeps standard semver ordering below it.
 */
describe("downstream rebuild ordering", () => {
  it("ranks a downstream rebuild above the release it rebuilds", () => {
    expect(isNewerVersion("1.3.5-acme.1", "1.3.5")).toBe(true);
    expect(isNewerVersion("1.3.5", "1.3.5-acme.1")).toBe(false);
  });

  it("ranks later rebuild counters above earlier ones", () => {
    expect(isNewerVersion("1.3.5-acme.2", "1.3.5-acme.1")).toBe(true);
    expect(isNewerVersion("1.3.5-acme.3", "1.3.5-acme.2")).toBe(true);
    expect(isNewerVersion("1.3.5-acme.2", "1.3.5-acme.3")).toBe(false);
    expect(isNewerVersion("1.3.5-acme.10", "1.3.5-acme.9")).toBe(true);
  });

  it("treats an identical version as not newer", () => {
    expect(isNewerVersion("1.3.5-acme.2", "1.3.5-acme.2")).toBe(false);
    expect(isNewerVersion("1.3.5", "1.3.5")).toBe(false);
  });

  it("keeps the next upstream release above every rebuild of the previous one", () => {
    expect(isNewerVersion("1.3.6", "1.3.5-acme.9")).toBe(true);
    expect(isNewerVersion("1.3.5-acme.9", "1.3.6")).toBe(false);
  });

  it("keeps standard semver ordering for upstream prereleases", () => {
    expect(isNewerVersion("1.3.5", "1.3.5-beta.1")).toBe(true);
    expect(isNewerVersion("1.3.5-beta.1", "1.3.5")).toBe(false);
    expect(isNewerVersion("1.3.5-beta.2", "1.3.5-beta.1")).toBe(true);
  });

  it("ranks a rebuild above any prerelease of the same version", () => {
    expect(isNewerVersion("1.3.5-acme.1", "1.3.5-rc.1")).toBe(true);
  });

  it("orders a rebuild of a prerelease by its upstream part first", () => {
    expect(isNewerVersion("1.3.5-beta.1.acme.1", "1.3.5-beta.1")).toBe(true);
    expect(isNewerVersion("1.3.5-beta.2", "1.3.5-beta.1.acme.9")).toBe(true);
    expect(isNewerVersion("1.3.5", "1.3.5-beta.1.acme.9")).toBe(true);
  });

  it("sorts a full ladder ascending", () => {
    const ladder = [
      "1.3.5-acme.2",
      "1.3.6",
      "1.3.5",
      "1.3.5-beta.1",
      "1.3.5-acme.1",
      "1.3.5-beta.2",
    ];
    expect([...ladder].sort(compareVersionStrings)).toEqual([
      "1.3.5-beta.1",
      "1.3.5-beta.2",
      "1.3.5",
      "1.3.5-acme.1",
      "1.3.5-acme.2",
      "1.3.6",
    ]);
  });
});

describe("parseVersion suffix classification", () => {
  it("splits a downstream rebuild suffix", () => {
    const parsed = parseVersion("v1.3.5-acme.3");
    expect(parsed?.raw).toBe("1.3.5-acme.3");
    expect(parsed?.prerelease).toBe("acme.3");
    expect(parsed?.upstreamPrerelease).toBeNull();
    expect(parsed?.downstreamBuild).toBe("acme.3");
  });

  it("splits an upstream prerelease suffix", () => {
    const parsed = parseVersion("1.3.5-beta.2");
    expect(parsed?.upstreamPrerelease).toBe("beta.2");
    expect(parsed?.downstreamBuild).toBeNull();
  });

  it("splits a rebuild of a prerelease into both parts", () => {
    const parsed = parseVersion("1.3.5-beta.1.acme.2");
    expect(parsed?.upstreamPrerelease).toBe("beta.1");
    expect(parsed?.downstreamBuild).toBe("acme.2");
  });
});

describe("artifactVersion", () => {
  it("drops the downstream rebuild counter from artifact filenames", () => {
    expect(artifactVersion("1.3.5-acme.3")).toBe("1.3.5");
    expect(artifactVersion("v1.3.5-acme.3")).toBe("1.3.5");
  });

  it("keeps a plain version and an upstream prerelease intact", () => {
    expect(artifactVersion("1.3.5")).toBe("1.3.5");
    expect(artifactVersion("1.3.5-beta.2")).toBe("1.3.5-beta.2");
    expect(artifactVersion("1.3.5-beta.1.acme.2")).toBe("1.3.5-beta.1");
  });
});

describe("isStableVersion", () => {
  it("counts a downstream rebuild of a stable release as stable", () => {
    expect(isStableVersion("1.3.5")).toBe(true);
    expect(isStableVersion("1.3.5-acme.2")).toBe(true);
    expect(isStableVersion("1.3.5-beta.1")).toBe(false);
    expect(isStableVersion("1.3.5-beta.1.acme.1")).toBe(false);
    expect(isStableVersion("latest")).toBe(false);
  });
});

describe("isSameUpstreamRelease", () => {
  it("ignores a downstream rebuild counter on either side", () => {
    expect(isSameUpstreamRelease("1.3.5", "1.3.5-acme.2")).toBe(true);
    expect(isSameUpstreamRelease("1.3.5-acme.2", "1.3.5")).toBe(true);
    expect(isSameUpstreamRelease("1.3.5-acme.1", "1.3.5-acme.2")).toBe(true);
    expect(isSameUpstreamRelease("v1.3.5", "1.3.5-acme.2")).toBe(true);
    expect(isSameUpstreamRelease("1.3.5-beta.1", "1.3.5-beta.1.acme.2")).toBe(true);
  });

  it("still separates different upstream releases and prereleases", () => {
    expect(isSameUpstreamRelease("1.3.5", "1.3.6")).toBe(false);
    expect(isSameUpstreamRelease("1.3.5", "1.3.5-beta.1")).toBe(false);
    expect(isSameUpstreamRelease("1.3.5-beta.1", "1.3.5-beta.2")).toBe(false);
  });

  it("falls back to exact equality for unparsable versions", () => {
    expect(isSameUpstreamRelease("latest", "latest")).toBe(true);
    expect(isSameUpstreamRelease("latest", "1.3.5")).toBe(false);
  });
});
