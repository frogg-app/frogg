import { describe, expect, it } from "vitest";
import {
  authRefusal,
  identityMismatch,
  isUnregistered,
  offlineReason,
  pairingErrorText,
  registeredVia,
} from "./access";

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
  it("points the toast at pairing, naming the host", () => {
    const r = authRefusal(info("Device access revoked", true));
    expect(r?.action).toBe("Pair again…");
    expect(r?.toast("devbox").title).toBe("devbox turned this app away");
    expect(authRefusal(info("Pairing required"))?.action).toBe("Pair this app…");
  });
});

describe("identityMismatch", () => {
  const wrong = {
    code: "server_identity_mismatch",
    expectedServerId: "srv_old",
    actualServerId: "srv_new",
  } as const;
  it("reads the saved and the answering daemon", () => {
    expect(identityMismatch(null)).toBeNull();
    const m = identityMismatch(wrong);
    expect(m).toMatchObject({ expected: "srv_old", actual: "srv_new" });
    expect(m?.title("10.0.0.5:6767")).toBe(
      "A different Frogg daemon is answering at 10.0.0.5:6767",
    );
  });
  it("gives the one-line reason the host list shows", () => {
    expect(offlineReason({ error: wrong, reason: "x" })).toMatch(/different daemon/);
    expect(offlineReason({ error: null, reason: "Transport closed" })).toBe("Transport closed");
    expect(offlineReason({ error: null, reason: null })).toBe("No answer from the daemon");
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
