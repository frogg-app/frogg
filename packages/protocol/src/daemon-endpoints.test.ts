import { describe, expect, it, test } from "vitest";

import {
  buildDaemonWebSocketUrl,
  buildRelayWebSocketUrl,
  CURRENT_RELAY_PROTOCOL_VERSION,
  extractHostPortFromWebSocketUrl,
  normalizeRelayProtocolVersion,
  parseConnectionUri,
  serializeConnectionUri,
  serializeConnectionUriForStorage,
  shouldUseTlsForDefaultHostedRelay,
  isVirtualInterfaceName,
  rankLanIpv4Addresses,
} from "./daemon-endpoints.js";

describe("connection URI parsing", () => {
  test("round-trips a tcp host and port", () => {
    const parsed = parseConnectionUri("tcp://localhost:9999");

    expect(parsed).toEqual({
      host: "localhost",
      port: 9999,
      isIpv6: false,
      useTls: false,
    });
    expect(serializeConnectionUri(parsed)).toBe("tcp://localhost:9999");
  });

  test("round-trips an SSL-enabled tcp host and port", () => {
    const parsed = parseConnectionUri("tcp://example.com:443?ssl=true");

    expect(parsed).toEqual({
      host: "example.com",
      port: 443,
      isIpv6: false,
      useTls: true,
    });
    expect(serializeConnectionUri(parsed)).toBe("tcp://example.com:443?ssl=true");
  });

  test("round-trips an IPv6 host", () => {
    const parsed = parseConnectionUri("tcp://[::1]:9999?ssl=true");

    expect(parsed).toEqual({
      host: "::1",
      port: 9999,
      isIpv6: true,
      useTls: true,
    });
    expect(serializeConnectionUri(parsed)).toBe("tcp://[::1]:9999?ssl=true");
  });

  test("rejects a missing port", () => {
    expect(() => parseConnectionUri("tcp://localhost")).toThrow("Connection URI port is required");
  });

  test("rejects an invalid scheme", () => {
    expect(() => parseConnectionUri("http://localhost:9999")).toThrow(
      "Connection URI protocol must be tcp:",
    );
  });

  test("parses password without including it in the public serializer", () => {
    const parsed = parseConnectionUri("tcp://localhost:9999?ssl=true&password=secret");

    expect(parsed).toEqual({
      host: "localhost",
      port: 9999,
      isIpv6: false,
      useTls: true,
      password: "secret",
    });
    expect(serializeConnectionUri(parsed)).toBe("tcp://localhost:9999?ssl=true");
    expect(serializeConnectionUriForStorage(parsed)).toBe(
      "tcp://localhost:9999?ssl=true&password=secret",
    );
  });

  test("rejects userinfo passwords", () => {
    expect(() => parseConnectionUri("tcp://:secret@localhost:9999?ssl=true")).toThrow(
      "Connection URI userinfo is not supported",
    );
  });
});

describe("daemon websocket URLs", () => {
  test("uses ws for port 443 when TLS is disabled", () => {
    expect(buildDaemonWebSocketUrl("example.com:443", { useTls: false })).toBe(
      "ws://example.com:443/ws",
    );
  });

  test("uses wss for non-443 ports when TLS is enabled", () => {
    expect(buildDaemonWebSocketUrl("example.com:9999", { useTls: true })).toBe(
      "wss://example.com:9999/ws",
    );
  });
});

describe("relay websocket URL versioning", () => {
  test("defaults relay URLs to v2", () => {
    const url = new URL(
      buildRelayWebSocketUrl({
        endpoint: "relay.example.test:443",
        useTls: true,
        serverId: "srv_test",
        role: "client",
      }),
    );

    expect(url.searchParams.get("v")).toBe(CURRENT_RELAY_PROTOCOL_VERSION);
    expect(url.searchParams.has("connectionId")).toBe(false);
  });

  test("includes connectionId when provided (server data sockets)", () => {
    const url = new URL(
      buildRelayWebSocketUrl({
        endpoint: "relay.example.test:443",
        useTls: true,
        serverId: "srv_test",
        role: "server",
        connectionId: "conn_abc123",
      }),
    );

    expect(url.searchParams.get("connectionId")).toBe("conn_abc123");
  });

  test("allows explicitly requesting v1 relay URLs", () => {
    const url = new URL(
      buildRelayWebSocketUrl({
        endpoint: "relay.example.test:443",
        useTls: true,
        serverId: "srv_test",
        role: "server",
        version: "1",
      }),
    );

    expect(url.searchParams.get("v")).toBe("1");
  });

  test("normalizes numeric relay versions", () => {
    expect(normalizeRelayProtocolVersion(2)).toBe("2");
    expect(normalizeRelayProtocolVersion(1)).toBe("1");
  });

  test("rejects unsupported relay versions", () => {
    expect(() => normalizeRelayProtocolVersion("3")).toThrow('Relay version must be "1" or "2"');
  });
});

describe("relay websocket URLs", () => {
  test("uses ws for port 443 when TLS is disabled", () => {
    const url = new URL(
      buildRelayWebSocketUrl({
        endpoint: "relay.example.test:443",
        useTls: false,
        serverId: "srv_test",
        role: "client",
      }),
    );

    expect(url.protocol).toBe("ws:");
  });

  test("uses wss for non-443 ports when TLS is enabled", () => {
    const url = new URL(
      buildRelayWebSocketUrl({
        endpoint: "relay.example.test:9999",
        useTls: true,
        serverId: "srv_test",
        role: "client",
      }),
    );

    expect(url.protocol).toBe("wss:");
  });

  test("round-trips IPv6 relay endpoints with TLS enabled", () => {
    const wsUrl = buildRelayWebSocketUrl({
      endpoint: "[::1]:443",
      useTls: true,
      serverId: "srv_test",
      role: "client",
    });
    const url = new URL(wsUrl);

    expect(url.protocol).toBe("wss:");
    expect(extractHostPortFromWebSocketUrl(wsUrl)).toBe("[::1]:443");
  });
});

describe("shouldUseTlsForDefaultHostedRelay", () => {
  test("returns true for the hosted Frogg relay on port 443", () => {
    expect(shouldUseTlsForDefaultHostedRelay("relay.example.test:443")).toBe(true);
  });

  test("returns true for any self-hosted relay on port 443", () => {
    expect(shouldUseTlsForDefaultHostedRelay("relay.example.com:443")).toBe(true);
  });

  test("returns true for an IPv6 relay on port 443", () => {
    expect(shouldUseTlsForDefaultHostedRelay("[::1]:443")).toBe(true);
  });

  test("returns false for a relay on a non-443 port", () => {
    expect(shouldUseTlsForDefaultHostedRelay("relay.example.com:8080")).toBe(false);
  });

  test("returns false for malformed endpoints", () => {
    expect(shouldUseTlsForDefaultHostedRelay("not-an-endpoint")).toBe(false);
  });
});

describe("rankLanIpv4Addresses", () => {
  const v4 = (address: string, internal = false) => ({ address, family: "IPv4", internal });

  it("puts the physical interface ahead of Docker bridges that sort first by name", () => {
    expect(
      rankLanIpv4Addresses({
        "br-1ea1fa522000": [v4("172.25.0.1")],
        docker0: [v4("172.17.0.1")],
        ens18: [v4("192.168.1.17"), { address: "fe80::1", family: "IPv6", internal: false }],
        lo: [v4("127.0.0.1", true)],
        veth12ab: [v4("172.17.0.9")],
      }),
    ).toEqual(["192.168.1.17", "172.25.0.1", "172.17.0.1", "172.17.0.9"]);
  });

  it("keeps VPN interfaces such as Tailscale in the preferred group", () => {
    expect(
      rankLanIpv4Addresses({ "br-abc": [v4("172.20.0.1")], tailscale0: [v4("100.64.0.7")] }),
    ).toEqual(["100.64.0.7", "172.20.0.1"]);
  });

  it("falls back to a bridge when it is the only external interface", () => {
    expect(rankLanIpv4Addresses({ docker0: [v4("172.17.0.1")] })).toEqual(["172.17.0.1"]);
  });

  it("recognises virtual interface names", () => {
    for (const name of ["docker0", "br-1ea1fa522000", "veth9f", "virbr0", "vEthernet (WSL)"]) {
      expect(isVirtualInterfaceName(name)).toBe(true);
    }
    for (const name of ["ens18", "eth0", "wlan0", "en0", "tailscale0", "bridge0"]) {
      expect(isVirtualInterfaceName(name)).toBe(false);
    }
  });
});
