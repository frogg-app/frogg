import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

// A non-upstream brand defaults trustLan off; claim-status must report that
// rather than the upstream default.
vi.mock("@frogg/branding", async () => {
  const { resolveBrandManifest } = await import("@frogg/branding/schema");
  return {
    brand: resolveBrandManifest({
      schemaVersion: 1,
      id: "acme",
      name: "Acme Studio",
      applicationId: "com.acme.studio",
      daemonPort: 10099,
      assets: { icon: "icon.png" },
    }),
  };
});

const { describeClaimStatus } = await import("./claim.js");

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

test("claim-status reports the brand's LAN-trust default", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "acme-cli-claim-"));
  homes.push(home);
  expect((await describeClaimStatus(home)).lanTrusted).toBe(false);
});
