import { describe, expect, test, vi } from "vitest";

import { createDeviceClaimHandler, type DeviceAccessDependencies } from "./device-access-routes.js";
import type { MintedPrincipal } from "./claim-store.js";

/**
 * Every way in reports the pairing, so bootstrap can re-send server_info and
 * connected owners see the claimed posture without reconnecting.
 */
describe("device claim handler onPaired", () => {
  function setup() {
    const minted: MintedPrincipal = {
      principalId: "p1",
      credentialId: "c1",
      credential: "secret",
      role: "viewer",
      deviceName: "Phone",
      permissions: [],
    } as unknown as MintedPrincipal;
    const onPaired = vi.fn();
    const deps = {
      serverId: "srv",
      daemonPublicKeyB64: "AAAA",
      claimStore: { mintPrincipal: vi.fn(() => minted), isClaimed: () => true },
      pairingCodes: { redeem: vi.fn(() => ({ role: "viewer" })) },
      offers: { consume: vi.fn(() => true) },
      auth: {},
      claimMode: () => false,
      onPaired,
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as DeviceAccessDependencies;
    const res = { status: vi.fn(() => res), json: vi.fn(() => res) };
    return { deps, res, onPaired, minted };
  }

  test("a redeemed pairing code reports the pairing", () => {
    const { deps, res, onPaired, minted } = setup();
    createDeviceClaimHandler(deps)(
      { body: { pairingCode: "ABCD2345" }, header: () => undefined, socket: {} } as never,
      res as never,
      () => undefined,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(onPaired).toHaveBeenCalledWith({ minted, via: "code" });
  });

  test("a consumed offer token reports the pairing", () => {
    const { deps, res, onPaired, minted } = setup();
    createDeviceClaimHandler(deps)(
      { body: { token: "offer" }, header: () => undefined, socket: {} } as never,
      res as never,
      () => undefined,
    );
    expect(onPaired).toHaveBeenCalledWith({ minted, via: "claim" });
  });
});
