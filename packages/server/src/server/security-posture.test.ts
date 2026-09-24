import { describe, expect, test } from "vitest";

import { computeSecurityPosture, type SecurityPostureInput } from "./security-posture.js";

const LOOPBACK = { type: "tcp", host: "127.0.0.1", port: 6767 } as const;
const ALL = { type: "tcp", host: "0.0.0.0", port: 6767 } as const;

/** Stock upstream brand: bind all, LAN trusted, claim mode off. */
const STOCK = { bind: "all", trustLan: true, claimMode: false } as const;
/** Locked-down brand (any non-upstream default): loopback, LAN untrusted, claim mode on. */
const MANAGED = { bind: "loopback", trustLan: false, claimMode: true } as const;

function ids(input: Partial<SecurityPostureInput> & Pick<SecurityPostureInput, "brand">) {
  return computeSecurityPosture({
    claimMode: false,
    trustLan: false,
    hasPassword: false,
    claimed: false,
    listenTarget: LOOPBACK,
    ...input,
  }).findings.map((f) => `${f.id}:${f.severity}:${f.fixAction}`);
}

describe("computeSecurityPosture", () => {
  test("managed brand at its defaults, claimed: no findings", () => {
    expect(ids({ brand: MANAGED, claimMode: true, claimed: true })).toEqual([]);
  });

  test("unclaimed: warning on loopback, critical when exposed", () => {
    expect(ids({ brand: MANAGED, claimMode: true })).toEqual(["unclaimed:warning:claim"]);
    expect(ids({ brand: MANAGED, claimMode: true, listenTarget: ALL })).toEqual([
      "unclaimed:critical:claim",
      "bind_diverges:warning:bind_loopback",
    ]);
  });

  test("unclaimed does not apply without claim mode", () => {
    expect(ids({ brand: STOCK })).toEqual([]);
  });

  test("exposed_without_password: stock brand at its defaults", () => {
    expect(ids({ brand: STOCK, listenTarget: ALL, trustLan: true })).toEqual([
      "exposed_without_password:critical:set_password",
    ]);
  });

  test("exposed_without_password never fires for a loopback-only bind", () => {
    expect(ids({ brand: STOCK, trustLan: true })).toEqual([]);
    expect(ids({ brand: STOCK, listenTarget: { type: "tcp", host: "[::1]", port: 1 } })).toEqual(
      [],
    );
    expect(
      ids({ brand: STOCK, listenTarget: { type: "tcp", host: "localhost", port: 1 } }),
    ).toEqual([]);
    expect(ids({ brand: STOCK, listenTarget: ALL })).toEqual([
      "exposed_without_password:critical:set_password",
    ]);
  });

  test("a password or claim mode clears exposed_without_password", () => {
    expect(ids({ brand: STOCK, listenTarget: ALL, trustLan: true, hasPassword: true })).toEqual([]);
    expect(ids({ brand: STOCK, listenTarget: ALL, claimMode: true, claimed: true })).toEqual([]);
  });

  test("trust_lan_diverges only against a brand that ships it off", () => {
    expect(ids({ brand: MANAGED, trustLan: true, hasPassword: true })).toContain(
      "trust_lan_diverges:warning:disable_trust_lan",
    );
    expect(ids({ brand: STOCK, trustLan: true, hasPassword: true })).toEqual([]);
  });

  test("bind_diverges only against a loopback brand", () => {
    expect(ids({ brand: MANAGED, claimMode: true, claimed: true, listenTarget: ALL })).toEqual([
      "bind_diverges:warning:bind_loopback",
    ]);
    expect(ids({ brand: STOCK, hasPassword: true, listenTarget: ALL })).toEqual([]);
    expect(
      ids({
        brand: MANAGED,
        claimMode: true,
        claimed: true,
        listenTarget: { type: "socket", path: "/tmp/d.sock" },
      }),
    ).toEqual([]);
    expect(
      ids({
        brand: MANAGED,
        claimMode: true,
        claimed: true,
        listenTarget: { type: "tcp", host: "[::1]", port: 1 },
      }),
    ).toEqual([]);
  });

  test("claim_mode_diverges only against a brand that ships it on", () => {
    expect(ids({ brand: MANAGED, hasPassword: true })).toEqual([
      "claim_mode_diverges:warning:enable_claim_mode",
    ]);
    expect(ids({ brand: STOCK, hasPassword: true })).toEqual([]);
  });

  test("acknowledged findings, critical included, move out of findings", () => {
    const posture = computeSecurityPosture({
      claimMode: false,
      trustLan: false,
      hasPassword: false,
      claimed: false,
      listenTarget: ALL,
      brand: MANAGED,
      acknowledged: new Set(["bind_diverges", "exposed_without_password"]),
    });
    expect(posture.findings.map((f) => f.id)).toEqual(["claim_mode_diverges"]);
    expect(posture.acknowledged?.map((f) => f.id)).toEqual([
      "exposed_without_password",
      "bind_diverges",
    ]);
  });

  test("an acknowledgement for a finding that is not present adds nothing", () => {
    const posture = computeSecurityPosture({
      claimMode: true,
      trustLan: false,
      hasPassword: false,
      claimed: true,
      listenTarget: LOOPBACK,
      brand: MANAGED,
      acknowledged: new Set(["bind_diverges"]),
    });
    expect(posture).toEqual({ findings: [] });
  });
});
