import { describe, expect, it, vi, beforeEach } from "vitest";
import appPackage from "../../package.json";

const appPackageVersion = appPackage.version;

/**
 * A downstream rebuild publishes `1.4.1-acme.2` while the workspace version stays
 * at upstream's `1.4.1`. The app has to report what it published, or About
 * disagrees with the daemon the user is connected to.
 */
describe("app version with a stamped release", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("prefers the stamped release version", async () => {
    vi.doMock("@frogg/branding", () => ({ release: { version: "1.4.1-acme.2" } }));
    const { resolveAppVersion } = await import("./app-version");
    expect(resolveAppVersion()).toBe("1.4.1-acme.2");
  });

  it("falls back to the package version when nothing was stamped", async () => {
    vi.doMock("@frogg/branding", () => ({ release: { version: null } }));
    const { resolveAppVersion } = await import("./app-version");
    expect(resolveAppVersion()).toBe(appPackageVersion);
  });
});
