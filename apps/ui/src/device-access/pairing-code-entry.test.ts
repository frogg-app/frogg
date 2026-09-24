import { describe, expect, it } from "vitest";
import {
  entryEndpoint,
  formatPairingCodeInput,
  pairingLinkFromEntry,
  parsePairingCodeEntry,
} from "./pairing-code-entry";

describe("formatPairingCodeInput", () => {
  it("groups the code as it is typed", () => {
    expect(formatPairingCodeInput("abcd")).toBe("ABCD");
    expect(formatPairingCodeInput("abcdefgh")).toBe("ABCD-EFGH");
  });

  it("folds the ambiguous characters the daemon folds", () => {
    expect(formatPairingCodeInput("iloiloxx")).toBe("1101-10XX");
  });

  it("ignores separators and stops at eight symbols", () => {
    expect(formatPairingCodeInput("ab cd-ef gh ij")).toBe("ABCD-EFGH");
  });
});

describe("parsePairingCodeEntry", () => {
  const code = "ABCD-EFGH";

  it("defaults the port", () => {
    expect(parsePairingCodeEntry({ endpoint: "10.0.0.5", code, useTls: false })).toEqual({
      ok: true,
      host: "10.0.0.5",
      port: 9999,
      useTls: false,
      code: "ABCDEFGH",
    });
  });

  it("takes an explicit port", () => {
    const parsed = parsePairingCodeEntry({ endpoint: "host.local:8443", code, useTls: true });
    expect(parsed).toMatchObject({ ok: true, host: "host.local", port: 8443, useTls: true });
  });

  it("accepts a pasted URL and a bracketed IPv6 address", () => {
    expect(
      parsePairingCodeEntry({ endpoint: "http://10.0.0.5:9999", code, useTls: false }),
    ).toMatchObject({ ok: true, host: "10.0.0.5", port: 9999 });
    expect(
      parsePairingCodeEntry({ endpoint: "[fd00::1]:9999", code, useTls: false }),
    ).toMatchObject({
      ok: true,
      host: "fd00::1",
      port: 9999,
    });
    expect(parsePairingCodeEntry({ endpoint: "fd00::1", code, useTls: false })).toMatchObject({
      ok: true,
      host: "fd00::1",
      port: 9999,
    });
  });

  it("separates an unfinished code from a wrong one", () => {
    expect(parsePairingCodeEntry({ endpoint: "h", code: "ABC", useTls: false })).toEqual({
      ok: false,
      problem: "code_incomplete",
    });
    expect(parsePairingCodeEntry({ endpoint: "h", code: "ABCDEF!!", useTls: false })).toEqual({
      ok: false,
      problem: "code_invalid",
    });
  });

  it("rejects an empty host and an impossible port", () => {
    expect(parsePairingCodeEntry({ endpoint: "  ", code, useTls: false })).toEqual({
      ok: false,
      problem: "host_required",
    });
    expect(parsePairingCodeEntry({ endpoint: "host:99999", code, useTls: false })).toEqual({
      ok: false,
      problem: "port_invalid",
    });
  });
});

describe("pairingLinkFromEntry", () => {
  it("pins the fingerprint the daemon proved, not one the user typed", () => {
    const parsed = parsePairingCodeEntry({
      endpoint: "10.0.0.5:9999",
      code: "ABCD-EFGH",
      useTls: true,
    });
    if (!parsed.ok) throw new Error("expected a parse");
    expect(
      pairingLinkFromEntry(parsed, { serverId: "server-1", fingerprint: "sha256:abc" }),
    ).toEqual({
      v: 1,
      host: "10.0.0.5",
      port: 9999,
      fingerprint: "sha256:abc",
      pairingCode: "ABCDEFGH",
      serverId: "server-1",
      useTls: true,
    });
  });
});

describe("entryEndpoint", () => {
  it("brackets a bare IPv6 host", () => {
    expect(entryEndpoint({ host: "fd00::1", port: 9999 })).toBe("[fd00::1]:9999");
    expect(entryEndpoint({ host: "10.0.0.5", port: 9999 })).toBe("10.0.0.5:9999");
  });
});
