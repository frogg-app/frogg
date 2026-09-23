import { describe, expect, it } from "vitest";
import { brand } from "@frogg/branding";
import { daemonKeyFingerprint } from "@frogg/protocol/device-access";
import {
  clearPendingPairTarget,
  extractOfferLink,
  extractPairTarget,
  peekPendingPairTarget,
  setPendingOfferUrl,
  setPendingPairTarget,
  subscribePendingPairTarget,
  takePendingOfferUrl,
  takePendingPairTarget,
} from "./pending-offer";

const FINGERPRINT = daemonKeyFingerprint("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=");

describe("extractOfferLink", () => {
  it("accepts fragment, query, and deep-link forms", () => {
    expect(extractOfferLink("https://frogg.app/pair#offer=abc")).toBe(
      "https://frogg.app/pair#offer=abc",
    );
    expect(extractOfferLink("frogg://pair#offer=abc")).toBe("frogg://pair#offer=abc");
    expect(extractOfferLink("http://192.168.1.5:8081/?offer=abc&x=1")).toBe("#offer=abc");
    expect(extractOfferLink("http://192.168.1.5:8081/?offer=abc#/welcome")).toBe("#offer=abc");
  });

  it("accepts pair.frogg.app code links and the ?code= form", () => {
    expect(extractOfferLink("https://pair.frogg.app/code/abc")).toBe("#offer=abc");
    expect(extractOfferLink("https://pair.frogg.app/code/abc/")).toBe("#offer=abc");
    expect(extractOfferLink("http://192.168.1.5:9999/code/abc")).toBe("#offer=abc");
    expect(extractOfferLink("https://pair.frogg.app/pair?code=abc")).toBe("#offer=abc");
  });

  it("returns null without an offer", () => {
    expect(extractOfferLink("https://frogg.app/pair")).toBeNull();
    expect(extractOfferLink("https://frogg.app/pair#offer=")).toBeNull();
    expect(extractOfferLink("http://localhost:8081/?other=1")).toBeNull();
    expect(extractOfferLink("https://pair.frogg.app/code/")).toBeNull();
    expect(extractOfferLink("https://pair.frogg.app/pair?code=")).toBeNull();
    expect(extractOfferLink(null)).toBeNull();
  });
});

describe("pending offer", () => {
  it("is taken once", () => {
    setPendingOfferUrl("frogg://pair#offer=abc");
    expect(takePendingOfferUrl()).toBe("frogg://pair#offer=abc");
    expect(takePendingOfferUrl()).toBeNull();
  });
});

describe("extractPairTarget", () => {
  const directLink = (scheme: string, extra = "") =>
    `${scheme}://pair/direct?v=1&host=192.168.1.10&port=9999&fp=${encodeURIComponent(FINGERPRINT)}${extra}`;

  it("recognises a direct pairing link under the brand scheme and the frogg fallback", () => {
    for (const scheme of new Set([brand.scheme, "frogg"])) {
      const target = extractPairTarget(directLink(scheme, "&claim=1&role=owner"));
      expect(target).toMatchObject({
        kind: "direct",
        link: { host: "192.168.1.10", port: 9999, claim: true, role: "owner" },
      });
    }
  });

  it("still recognises the offer forms", () => {
    expect(extractPairTarget("https://frogg.app/pair#offer=abc")).toEqual({
      kind: "offer",
      url: "https://frogg.app/pair#offer=abc",
    });
    expect(extractPairTarget("https://pair.frogg.app/code/abc")).toEqual({
      kind: "offer",
      url: "#offer=abc",
    });
    expect(extractPairTarget("https://frogg.app/pair")).toBeNull();
    expect(extractPairTarget(null)).toBeNull();
  });

  it("keeps the single-use slot discipline for direct links", () => {
    const target = extractPairTarget(directLink(brand.scheme))!;
    setPendingPairTarget(target);
    expect(takePendingPairTarget()).toBe(target);
    expect(takePendingPairTarget()).toBeNull();
  });

  it("does not hand a direct link to the legacy offer accessor", () => {
    setPendingPairTarget(extractPairTarget(directLink(brand.scheme))!);
    expect(takePendingOfferUrl()).toBeNull();
    setPendingOfferUrl("#offer=abc");
    expect(takePendingOfferUrl()).toBe("#offer=abc");
  });
});

describe("the web fragment form", () => {
  const params = `v=1&host=192.168.1.10&port=9999&fp=${encodeURIComponent(FINGERPRINT)}`;

  it("accepts a direct pairing link a browser can actually reach", () => {
    // A browser never navigates to `<scheme>://…`, so the web build has to
    // take the same parameters off an ordinary https page.
    expect(extractPairTarget(`https://example.test/app/#pair/direct?${params}&claim=1`)).toMatchObject(
      { kind: "direct", link: { host: "192.168.1.10", port: 9999, claim: true } },
    );
  });

  it("ignores a fragment that is not a pairing link", () => {
    expect(extractPairTarget("https://example.test/#pair/direct?v=1")).toBeNull();
    expect(extractPairTarget("https://example.test/#settings")).toBeNull();
  });
});

describe("reading the slot without consuming it", () => {
  const target = { kind: "offer", url: "#offer=abc" } as const;

  it("survives a remount, which is what a peek is for", () => {
    setPendingPairTarget(target);
    expect(peekPendingPairTarget()).toEqual(target);
    // A screen that mounts, unmounts and mounts again still finds the link.
    expect(peekPendingPairTarget()).toEqual(target);
    clearPendingPairTarget();
    expect(peekPendingPairTarget()).toBeNull();
  });

  it("notifies subscribers when a link arrives and when it is cleared", () => {
    let calls = 0;
    const unsubscribe = subscribePendingPairTarget(() => {
      calls += 1;
    });
    setPendingPairTarget(target);
    clearPendingPairTarget();
    unsubscribe();
    setPendingPairTarget(target);
    clearPendingPairTarget();
    expect(calls).toBe(2);
  });
});
