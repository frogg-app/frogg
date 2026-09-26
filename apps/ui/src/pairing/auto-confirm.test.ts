import { describe, expect, it } from "vitest";
import type { DirectPairingLink } from "@frogg/protocol/device-access";
import { canAutoConfirmDirectLink } from "./auto-confirm";

const LINK: DirectPairingLink = {
  v: 1,
  host: "127.0.0.1",
  port: 9999,
  fingerprint: "sha256:abcdef",
  pairingCode: "ABCD2345",
  serverId: "srv_1",
  role: "owner",
};

describe("canAutoConfirmDirectLink", () => {
  it("accepts a loopback code link when the brand opts in", () => {
    for (const host of ["127.0.0.1", "::1", "[::1]", "localhost", "LOCALHOST"]) {
      expect(canAutoConfirmDirectLink({ ...LINK, host }, true)).toBe(true);
    }
  });

  it("asks when the brand has not opted in", () => {
    expect(canAutoConfirmDirectLink(LINK, false)).toBe(false);
  });

  it("asks for a host that is not loopback", () => {
    for (const host of ["192.168.1.10", "studio.lan", "127.0.0.2", "0.0.0.0", "localhost.evil"]) {
      expect(canAutoConfirmDirectLink({ ...LINK, host }, true)).toBe(false);
    }
  });

  it("asks for a claim link, which carries no code", () => {
    const { pairingCode: _code, ...claim } = LINK;
    expect(canAutoConfirmDirectLink({ ...claim, claim: true }, true)).toBe(false);
  });
});
