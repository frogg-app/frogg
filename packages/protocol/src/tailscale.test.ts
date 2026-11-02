import { describe, expect, test } from "vitest";

import { isTailnetAddress, keyExpiryState, parseTailscaleStatus } from "./tailscale.js";

describe("tailnet addresses", () => {
  test.each([
    "100.101.102.103:9999",
    "100.64.0.1",
    "100.127.255.254:443",
    "devbox.tail1234.ts.net:9999",
    "wss://devbox.tail1234.ts.net/ws",
    "[fd7a:115c:a1e0::1]:9999",
  ])("%s is on a tailnet", (endpoint) => {
    expect(isTailnetAddress(endpoint)).toBe(true);
  });

  test.each([
    "100.63.0.1:9999",
    "100.128.0.1",
    "192.168.1.5:9999",
    "devbox.lan:9999",
    "relay.frogg.app",
  ])("%s is not", (endpoint) => {
    expect(isTailnetAddress(endpoint)).toBe(false);
  });
});

describe("key expiry", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  test.each([
    [null, "none"],
    ["2027-03-01T00:00:00Z", "ok"],
    ["2026-11-10T12:00:00Z", "soon"],
    ["2026-11-03T12:00:00Z", "urgent"],
    ["2026-11-01T00:00:00Z", "expired"],
  ] as const)("%s → %s", (keyExpiry, level) => {
    expect(keyExpiryState({ keyExpiry }, now).level).toBe(level);
  });

  test("counts whole days left", () => {
    expect(keyExpiryState({ keyExpiry: "2026-11-10T12:00:00Z" }, now).daysLeft).toBe(8);
  });
});

describe("parsing tailscale status --json", () => {
  test("reads the node's state, name and key expiry", () => {
    expect(
      parseTailscaleStatus({
        BackendState: "Running",
        Self: { DNSName: "devbox.tail1234.ts.net.", KeyExpiry: "2027-04-30T10:00:00Z" },
      }),
    ).toEqual({
      online: true,
      dnsName: "devbox.tail1234.ts.net",
      keyExpiry: "2027-04-30T10:00:00Z",
    });
  });

  test("no KeyExpiry (or a zero time) means expiry is disabled", () => {
    expect(parseTailscaleStatus({ BackendState: "Running", Self: {} })?.keyExpiry).toBeNull();
    expect(
      parseTailscaleStatus({ BackendState: "Running", Self: { KeyExpiry: "0001-01-01T00:00:00Z" } })
        ?.keyExpiry,
    ).toBeNull();
  });

  test("a logged-out node is not online", () => {
    expect(parseTailscaleStatus({ BackendState: "NeedsLogin", Self: {} })?.online).toBe(false);
    expect(parseTailscaleStatus("nope")).toBeNull();
  });
});
