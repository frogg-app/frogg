import { brand } from "@frogg/branding";
import { describe, expect, it, vi } from "vitest";
import { isPairingOfferLink, PairingInbox } from "./pairing-inbox.js";

const DIRECT = `${brand.scheme}://pair/direct?v=1&host=127.0.0.1&port=9999&fp=sha256%3Aabc&pairingCode=ABCD-2345&sid=srv_1&role=owner`;

describe("PairingInbox", () => {
  it("recognises offer and direct pairing links", () => {
    expect(isPairingOfferLink("frogg://pair#offer=abc")).toBe(true);
    expect(isPairingOfferLink(`${brand.scheme}://pair#offer=abc`)).toBe(true);
    expect(isPairingOfferLink(DIRECT)).toBe(true);
    expect(isPairingOfferLink(DIRECT.replace(`${brand.scheme}://`, "frogg://"))).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isPairingOfferLink("frogg://pair")).toBe(false);
    expect(isPairingOfferLink("frogg://pair/direct?v=1&host=127.0.0.1")).toBe(false);
    expect(isPairingOfferLink("frogg://host/add?type=directTcp&host=localhost&port=9999")).toBe(
      false,
    );
    expect(isPairingOfferLink("/Users/me/project")).toBe(false);
  });

  it("holds a direct link that arrives before a renderer is ready", () => {
    const inbox = new PairingInbox();
    const listener = vi.fn();
    expect(inbox.receive(DIRECT)).toBe(true);
    inbox.ready(1, listener);
    expect(listener).toHaveBeenCalledWith(DIRECT);
  });
});
