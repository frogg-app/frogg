import { buildDirectPairingDeepLink } from "@frogg/protocol/device-access";
import { describe, expect, it } from "vitest";
import { isPairUrl, parsePairInput } from "./pairing";

const link = (scheme: string) =>
  buildDirectPairingDeepLink(
    {
      host: "127.0.0.1",
      port: 9999,
      fingerprint: "sha256:abcdef",
      pairingCode: "ABCD2345",
      label: "devbox",
    },
    scheme,
  );

describe("parsePairInput", () => {
  it("accepts direct links from the stable app, Frogg Next and retired beta daemons", () => {
    for (const scheme of ["frogg", "frogg-next", "frogg-beta"]) {
      const target = parsePairInput(link(scheme));
      expect(target?.kind).toBe("direct");
      if (target?.kind === "direct") {
        expect(target.link.host).toBe("127.0.0.1");
        expect(target.link.port).toBe(9999);
      }
      expect(isPairUrl(link(scheme))).toBe(true);
    }
  });

  it("refuses links of other apps", () => {
    expect(parsePairInput(link("other"))).toBeNull();
    expect(isPairUrl("other://pair/direct?v=1")).toBe(false);
  });

  it("redeems a bare code at the address given, which callers default to this app's daemon", () => {
    expect(parsePairInput("abcd-2345", "127.0.0.1:9999")).toEqual({
      kind: "code",
      code: "ABCD2345",
      endpoint: "127.0.0.1:9999",
      tls: false,
    });
  });
});
