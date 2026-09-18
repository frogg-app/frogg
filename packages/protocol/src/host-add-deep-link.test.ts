import { describe, expect, it } from "vitest";
import {
  buildHostAddDeepLink,
  hostAddDeepLinkEndpoint,
  parseHostAddDeepLink,
} from "./host-add-deep-link.js";

describe("host add deep links", () => {
  it("parses the documented rollout link", () => {
    const target = parseHostAddDeepLink(
      "frogg://host/add?type=directTcp&host=localhost&port=9999&label=Agent-Sandbox",
    );

    expect(target).toEqual({
      type: "directTcp",
      host: "localhost",
      port: 9999,
      useTls: false,
      label: "Agent-Sandbox",
    });
    expect(target && hostAddDeepLinkEndpoint(target)).toBe("localhost:9999");
  });

  it("round-trips a built link, including tls and a branded scheme", () => {
    const link = buildHostAddDeepLink(
      { host: "10.0.0.5", port: 443, useTls: true, label: "Sandbox" },
      "acme",
    );

    expect(link).toBe("acme://host/add?type=directTcp&host=10.0.0.5&port=443&tls=1&label=Sandbox");
    expect(parseHostAddDeepLink(link, "acme")).toEqual({
      type: "directTcp",
      host: "10.0.0.5",
      port: 443,
      useTls: true,
      label: "Sandbox",
    });
  });

  it("rejects links outside the host/add route", () => {
    expect(parseHostAddDeepLink("frogg://host/add?type=relay&host=a&port=1")).toBeNull();
    expect(parseHostAddDeepLink("frogg://host/add?type=directTcp&port=9999")).toBeNull();
    expect(parseHostAddDeepLink("frogg://host/add?type=directTcp&host=a&port=0")).toBeNull();
    expect(parseHostAddDeepLink("frogg://host/add?type=directTcp&host=a&port=99999")).toBeNull();
    expect(parseHostAddDeepLink("frogg://host/add?type=directTcp&host=a&port=x9")).toBeNull();
    expect(parseHostAddDeepLink("frogg://host/remove?type=directTcp&host=a&port=1")).toBeNull();
    expect(parseHostAddDeepLink("frogg://h/server/agent/agent-1")).toBeNull();
    expect(parseHostAddDeepLink("https://host/add?type=directTcp&host=a&port=1")).toBeNull();
    expect(parseHostAddDeepLink("not a url")).toBeNull();
  });

  it("does not build a link without a usable endpoint", () => {
    expect(() => buildHostAddDeepLink({ host: " ", port: 9999 })).toThrow();
    expect(() => buildHostAddDeepLink({ host: "localhost", port: 0 })).toThrow();
  });
});
