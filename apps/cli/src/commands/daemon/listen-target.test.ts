import { describe, expect, it } from "vitest";
import {
  isNonTcpListenTarget,
  normalizeListenTargetForConnect,
  resolveConnectableTcpHost,
  resolveTcpHostFromListen,
} from "./listen-target.js";

describe("normalizeListenTargetForConnect", () => {
  it("maps the IPv4 wildcard bind to IPv4 loopback", () => {
    expect(normalizeListenTargetForConnect("0.0.0.0:9999")).toBe("127.0.0.1:9999");
  });

  it("maps the unbracketed IPv6 wildcard bind to IPv6 loopback", () => {
    // `:::9999` is what Node reports for a `::` bind, and is not connectable.
    expect(normalizeListenTargetForConnect(":::9999")).toBe("[::1]:9999");
  });

  it("maps the bracketed IPv6 wildcard bind to IPv6 loopback", () => {
    expect(normalizeListenTargetForConnect("[::]:9999")).toBe("[::1]:9999");
  });

  it("maps a host-less target to IPv4 loopback", () => {
    expect(normalizeListenTargetForConnect(":9999")).toBe("127.0.0.1:9999");
  });

  it("leaves an explicit IPv4 host alone", () => {
    expect(normalizeListenTargetForConnect("127.0.0.1:9999")).toBe("127.0.0.1:9999");
  });

  it("leaves an explicit LAN host alone", () => {
    expect(normalizeListenTargetForConnect("192.168.1.20:9999")).toBe("192.168.1.20:9999");
    expect(normalizeListenTargetForConnect("daemon.internal:9999")).toBe("daemon.internal:9999");
  });

  it("leaves an explicit IPv6 host alone", () => {
    expect(normalizeListenTargetForConnect("[fd00::1]:9999")).toBe("[fd00::1]:9999");
    expect(normalizeListenTargetForConnect("[::1]:9999")).toBe("[::1]:9999");
  });

  it("expands a bare port to IPv4 loopback", () => {
    expect(normalizeListenTargetForConnect("9999")).toBe("127.0.0.1:9999");
  });

  it("leaves a unix socket path alone", () => {
    expect(normalizeListenTargetForConnect("/run/user/1000/frogg.sock")).toBe(
      "/run/user/1000/frogg.sock",
    );
    expect(normalizeListenTargetForConnect("unix:///tmp/frogg.sock")).toBe(
      "unix:///tmp/frogg.sock",
    );
  });

  it("leaves a Windows named pipe alone", () => {
    expect(normalizeListenTargetForConnect("\\\\.\\pipe\\frogg")).toBe("\\\\.\\pipe\\frogg");
  });

  it("preserves a tcp:// scheme while normalising the wildcard", () => {
    expect(normalizeListenTargetForConnect("tcp://:::9999")).toBe("tcp://[::1]:9999");
    expect(normalizeListenTargetForConnect("tcp://0.0.0.0:9999")).toBe("tcp://127.0.0.1:9999");
  });

  it("trims surrounding whitespace and rejects an empty target", () => {
    expect(normalizeListenTargetForConnect("  0.0.0.0:9999  ")).toBe("127.0.0.1:9999");
    expect(normalizeListenTargetForConnect("   ")).toBeNull();
  });
});

describe("resolveTcpHostFromListen", () => {
  it("reports the bind address as written so wildcards stay detectable", () => {
    // LAN enumeration and the loopback HTTP base both need to *see* the wildcard.
    expect(resolveTcpHostFromListen("0.0.0.0:9999")).toBe("0.0.0.0:9999");
    expect(resolveTcpHostFromListen(":::9999")).toBe(":::9999");
    expect(resolveTcpHostFromListen("[::]:9999")).toBe("[::]:9999");
  });

  it("expands a bare port and keeps explicit hosts", () => {
    expect(resolveTcpHostFromListen("9999")).toBe("127.0.0.1:9999");
    expect(resolveTcpHostFromListen("127.0.0.1:9999")).toBe("127.0.0.1:9999");
  });

  it("returns null when there is no TCP endpoint", () => {
    expect(resolveTcpHostFromListen("/run/frogg.sock")).toBeNull();
    expect(resolveTcpHostFromListen("unix:///tmp/frogg.sock")).toBeNull();
    expect(resolveTcpHostFromListen("\\\\.\\pipe\\frogg")).toBeNull();
    expect(resolveTcpHostFromListen("C:\\pipes\\frogg")).toBeNull();
    expect(resolveTcpHostFromListen("")).toBeNull();
    expect(resolveTcpHostFromListen("not-a-target")).toBeNull();
  });
});

describe("resolveConnectableTcpHost", () => {
  it("maps every wildcard bind to a dialable loopback host", () => {
    expect(resolveConnectableTcpHost("0.0.0.0:9999")).toBe("127.0.0.1:9999");
    expect(resolveConnectableTcpHost(":::9999")).toBe("[::1]:9999");
    expect(resolveConnectableTcpHost("[::]:9999")).toBe("[::1]:9999");
    expect(resolveConnectableTcpHost(":9999")).toBe("127.0.0.1:9999");
  });

  it("expands a bare port and keeps explicit hosts", () => {
    expect(resolveConnectableTcpHost("9999")).toBe("127.0.0.1:9999");
    expect(resolveConnectableTcpHost("127.0.0.1:9999")).toBe("127.0.0.1:9999");
    expect(resolveConnectableTcpHost("[fd00::1]:9999")).toBe("[fd00::1]:9999");
  });

  it("returns null when there is no TCP endpoint to dial", () => {
    expect(resolveConnectableTcpHost("/run/frogg.sock")).toBeNull();
    expect(resolveConnectableTcpHost("")).toBeNull();
  });
});

describe("isNonTcpListenTarget", () => {
  it("recognises socket and pipe targets only", () => {
    expect(isNonTcpListenTarget("/tmp/frogg.sock")).toBe(true);
    expect(isNonTcpListenTarget("0.0.0.0:9999")).toBe(false);
    expect(isNonTcpListenTarget("")).toBe(false);
  });
});
