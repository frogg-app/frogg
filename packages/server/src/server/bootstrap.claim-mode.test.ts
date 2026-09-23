import { expect, test } from "vitest";

import { shouldDropCredentiallessSessions } from "./bootstrap.js";

// Turning claim mode on withdraws LAN trust (`createAccessPolicy` ignores
// `trustLan` while it is on), so the clients the LAN let in without a device
// credential have to be evicted rather than kept until their next reconnect.
test("turning claim mode on evicts credentialless sessions even with trustLan set", () => {
  expect(shouldDropCredentiallessSessions({ trustLan: true, claimMode: true })).toBe(true);
});

test("withdrawing LAN trust evicts them too", () => {
  expect(shouldDropCredentiallessSessions({ trustLan: false, claimMode: false })).toBe(true);
});

test("an open daemon keeps its LAN sessions", () => {
  expect(shouldDropCredentiallessSessions({ trustLan: true, claimMode: false })).toBe(false);
});
