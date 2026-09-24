import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { brand } from "@frogg/branding";
import { createClaimStore } from "@frogg/server";
import { afterEach, describe, expect, test } from "vitest";

import { describeClaimStatus, resetClaim } from "./claim.js";
import { resolveLoopbackHttpBase } from "./daemon-http.js";

const homes: string[] = [];

function createHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "frogg-cli-claim-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("daemon claim-status / reset-claim", () => {
  test("reports an unclaimed home, then the paired principal, then resets it", async () => {
    const home = createHome();

    const before = await describeClaimStatus(home);
    expect(before).toMatchObject({
      claimed: false,
      claimedAt: null,
      passwordConfigured: false,
      principals: [],
      daemon: { reachable: false },
    });

    createClaimStore(home).mintPrincipal({ label: "Phone" });
    const after = await describeClaimStatus(home);
    expect(after.claimed).toBe(true);
    expect(after.principals).toHaveLength(1);
    expect(after.principals[0]).toMatchObject({ label: "Phone", credentials: 1 });

    const reset = resetClaim(home);
    expect(reset).toMatchObject({ action: "claim_reset", removedPrincipals: 1 });
    expect((await describeClaimStatus(home)).claimed).toBe(false);
    expect(resetClaim(home).action).toBe("not_claimed");
  });

  test("a configured password counts as claimed; LAN trust defaults to the brand", async () => {
    const home = createHome();
    expect((await describeClaimStatus(home)).lanTrusted).toBe(brand.daemon.trustLan);

    writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({
        daemon: {
          auth: {
            password: `$2b$10$${"a".repeat(53)}`,
            trustLan: !brand.daemon.trustLan,
          },
        },
      }),
    );
    const status = await describeClaimStatus(home);
    expect(status).toMatchObject({ claimed: true, passwordConfigured: true, principals: [] });
    expect(status.lanTrusted).toBe(!brand.daemon.trustLan);
  });

  test("turns a listen target into a loopback HTTP base", () => {
    expect(resolveLoopbackHttpBase("0.0.0.0:9999")).toBe("http://127.0.0.1:9999");
    expect(resolveLoopbackHttpBase("[::]:9999")).toBe("http://127.0.0.1:9999");
    expect(resolveLoopbackHttpBase("192.168.1.5:9999")).toBe("http://192.168.1.5:9999");
    expect(resolveLoopbackHttpBase("9998")).toBe("http://127.0.0.1:9998");
    expect(resolveLoopbackHttpBase("/tmp/frogg.sock")).toBeNull();
  });
});
