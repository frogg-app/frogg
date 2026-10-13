import { describe, expect, it } from "vitest";
import { pairingErrorText } from "./access";

describe("pairingErrorText", () => {
  it("explains a refused credential-less pairing offer", () => {
    const raw = new Error(
      "Session is not authorized for auth.pairing_code.create.request requestType=auth.pairing_code.create.request code=access_denied",
    );
    expect(pairingErrorText(raw)).toMatch(/without a device credential/);
  });
  it("passes other errors through", () => {
    expect(pairingErrorText(new Error("timed out"))).toBe("timed out");
  });
});
