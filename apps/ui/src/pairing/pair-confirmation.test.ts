import { describe, expect, it } from "vitest";
import { encodeOfferFragmentPayload } from "@frogg/protocol/connection-offer";
import { daemonKeyFingerprint, type DirectPairingLink } from "@frogg/protocol/device-access";
import { describePairTarget, isPairTargetExpired } from "./pair-confirmation";

const DAEMON_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const FINGERPRINT = daemonKeyFingerprint(DAEMON_KEY);

function directLink(overrides: Partial<DirectPairingLink> = {}): DirectPairingLink {
  return {
    v: 1,
    host: "192.168.1.10",
    port: 9999,
    fingerprint: FINGERPRINT,
    ...overrides,
  };
}

describe("describePairTarget", () => {
  it("describes a claiming direct link, warning included", () => {
    const described = describePairTarget({
      kind: "direct",
      link: directLink({ claim: true, role: "owner", label: "workshop", serverId: "srv-1" }),
    });
    expect(described?.details).toMatchObject({
      kind: "direct",
      endpoint: "192.168.1.10:9999",
      fingerprint: FINGERPRINT,
      isClaim: true,
      role: "owner",
      serverId: "srv-1",
      hostname: "workshop",
      requiresIdentityCheck: true,
    });
    expect(described?.details.formattedFingerprint).toContain(" ");
  });

  it("does not claim when the link carries a pairing code", () => {
    const described = describePairTarget({
      kind: "direct",
      link: directLink({ claim: true, pairingCode: "ABCD1234" }),
    });
    expect(described?.details.isClaim).toBe(false);
  });

  it("describes a v3 offer as a claim, with its expiry and computed fingerprint", () => {
    const url = `#offer=${encodeOfferFragmentPayload({
      v: 3,
      serverId: "srv-9",
      hostname: "studio",
      daemonPublicKeyB64: DAEMON_KEY,
      direct: { endpoints: ["192.168.1.10:9999"] },
      claim: { token: "tok", expiresAt: "2030-01-01T00:00:00.000Z" },
    })}`;
    const described = describePairTarget({ kind: "offer", url });
    expect(described?.details).toMatchObject({
      kind: "offer",
      endpoint: "192.168.1.10:9999",
      fingerprint: FINGERPRINT,
      isClaim: true,
      expiresAt: "2030-01-01T00:00:00.000Z",
      requiresIdentityCheck: false,
    });
    expect(isPairTargetExpired(described!.details, Date.parse("2020-01-01T00:00:00Z"))).toBe(false);
    expect(isPairTargetExpired(described!.details, Date.parse("2031-01-01T00:00:00Z"))).toBe(true);
  });

  it("describes a v2 relay offer without a claim warning or expiry", () => {
    const url = `#offer=${encodeOfferFragmentPayload({
      v: 2,
      serverId: "srv-2",
      daemonPublicKeyB64: DAEMON_KEY,
      relay: { endpoint: "relay.frogg.app:443", useTls: true },
    })}`;
    const described = describePairTarget({ kind: "offer", url });
    expect(described?.details.isClaim).toBe(false);
    expect(described?.details.expiresAt).toBeNull();
    expect(isPairTargetExpired(described!.details)).toBe(false);
  });

  it("returns null for a payload that is not an offer", () => {
    expect(describePairTarget({ kind: "offer", url: "#offer=bm90anNvbg" })).toBeNull();
  });
});
