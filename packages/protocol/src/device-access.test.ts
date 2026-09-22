import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildDirectPairingDeepLink,
  daemonKeyFingerprint,
  formatPairingCode,
  normalizePairingCode,
  parseDirectPairingDeepLink,
  sha256,
} from "./device-access.js";
import { extractPairingCode, isPairingDeepLink } from "./connection-offer.js";

describe("sha256", () => {
  it("matches node:crypto across block boundaries", () => {
    for (const length of [0, 1, 31, 55, 56, 63, 64, 65, 200]) {
      const data = randomBytes(length);
      expect(Buffer.from(sha256(data)).toString("hex")).toBe(
        createHash("sha256").update(data).digest("hex"),
      );
    }
  });
});

describe("daemonKeyFingerprint", () => {
  it("hashes the raw key bytes, accepting either base64 flavour", () => {
    const key = randomBytes(32);
    const expected = `sha256:${createHash("sha256").update(key).digest("base64url")}`;
    expect(daemonKeyFingerprint(key.toString("base64"))).toBe(expected);
    expect(daemonKeyFingerprint(key.toString("base64url"))).toBe(expected);
  });
});

describe("pairing codes", () => {
  it("normalizes case, separators and ambiguous letters", () => {
    expect(normalizePairingCode(" abcd-efgh ")).toBe("ABCDEFGH");
    expect(normalizePairingCode("0l1o-2345")).toBe("01102345");
    expect(normalizePairingCode("ABCD-EFGU")).toBeNull();
    expect(normalizePairingCode("ABC")).toBeNull();
    expect(formatPairingCode("abcdefgh")).toBe("ABCD-EFGH");
  });
});

describe("direct pairing deep link", () => {
  const fingerprint = daemonKeyFingerprint(randomBytes(32).toString("base64"));

  it("round-trips every field", () => {
    const link = buildDirectPairingDeepLink({
      host: "192.168.1.20",
      port: 9999,
      fingerprint,
      pairingCode: "abcdefgh",
      claim: true,
      useTls: true,
      serverId: "srv_1",
      label: "Studio Mac",
      role: "viewer",
    });
    expect(link.startsWith("frogg://pair/direct?v=1&host=192.168.1.20&port=9999&fp=")).toBe(true);
    expect(parseDirectPairingDeepLink(link)).toEqual({
      v: 1,
      host: "192.168.1.20",
      port: 9999,
      fingerprint,
      pairingCode: "ABCDEFGH",
      claim: true,
      useTls: true,
      serverId: "srv_1",
      label: "Studio Mac",
      role: "viewer",
    });
  });

  it("honours the brand scheme and rejects malformed links", () => {
    const link = buildDirectPairingDeepLink({ host: "h", port: 1, fingerprint }, "acme");
    expect(parseDirectPairingDeepLink(link, "acme")?.host).toBe("h");
    expect(parseDirectPairingDeepLink(link)).toBeNull();
    expect(
      parseDirectPairingDeepLink(`frogg://pair/direct?v=1&host=h&port=0&fp=${fingerprint}`),
    ).toBeNull();
    expect(parseDirectPairingDeepLink("frogg://pair/direct?v=1&host=h&port=1&fp=md5:x")).toBeNull();
    expect(
      parseDirectPairingDeepLink(
        `frogg://pair/direct?v=1&host=h&port=1&fp=${fingerprint}&pairingCode=zz`,
      ),
    ).toBeNull();
  });

  it("is invisible to the legacy offer-link parser", () => {
    const link = buildDirectPairingDeepLink({
      host: "h",
      port: 1,
      fingerprint,
      pairingCode: "ABCDEFGH",
    });
    expect(isPairingDeepLink(link)).toBe(false);
    expect(extractPairingCode(link)).toBeNull();
  });
});
