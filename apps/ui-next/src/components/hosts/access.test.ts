import { describe, expect, it } from "vitest";
import { authRefusal, isUnregistered, pairingErrorText, registeredVia } from "./access";

const refused = new Error(
  "Session is not authorized for auth.pairing_code.create.request requestType=auth.pairing_code.create.request code=access_denied",
);

describe("pairingErrorText", () => {
  it("names the role when a registered non-owner is refused", () => {
    expect(pairingErrorText(refused, "operator")).toMatch(/registered as an operator/);
  });
  it("explains a refused credential-less connection on an older daemon", () => {
    expect(pairingErrorText(refused)).toMatch(/without a device credential/);
  });
  it("passes other errors through", () => {
    expect(pairingErrorText(new Error("timed out"))).toBe("timed out");
  });
});

describe("authRefusal", () => {
  const info = (reason: string, credentialRejected = false) =>
    ({ code: "pairing_required", credentialRejected, reason }) as const;
  it("ignores other errors", () => {
    expect(authRefusal(null)).toBeNull();
    expect(
      authRefusal({ code: "server_identity_mismatch", expectedServerId: "a", actualServerId: "b" }),
    ).toBeNull();
  });
  it("tells an unclaimed daemon from a missing credential and a rejected one", () => {
    expect(authRefusal(info("Pairing required"))?.kind).toBe("unclaimed");
    expect(authRefusal(info("Password required"))?.kind).toBe("missing");
    expect(authRefusal(info("Device access revoked", true))?.kind).toBe("rejected");
  });
});

describe("device registration", () => {
  it("describes password and local registrations only", () => {
    expect(registeredVia({ pairedVia: "password" })).toMatch(/password/);
    expect(registeredVia({ pairedVia: "local" })).toMatch(/local/);
    expect(registeredVia({ pairedVia: "code" })).toBeNull();
  });
  it("flags a list with no entry for this connection", () => {
    expect(isUnregistered(null)).toBe(false);
    expect(isUnregistered([{ current: false }])).toBe(true);
    expect(isUnregistered([{ current: true }])).toBe(false);
  });
});
