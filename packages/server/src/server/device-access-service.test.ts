import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { normalizePairingCode, parseDirectPairingDeepLink } from "@frogg/protocol/device-access";

import { createClaimStore, type DeviceRecord } from "./claim-store.js";
import { createPairingCodeStore } from "./pairing-code-store.js";
import { createPairingRequestStore } from "./pairing-request-store.js";
import { createDeviceAccessService, DeviceAccessError } from "./device-access-service.js";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function harness(overrides: { claimMode?: boolean; trustLan?: boolean } = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), "frogg-device-access-"));
  homes.push(home);
  const claimStore = createClaimStore(home);
  const pairingCodes = createPairingCodeStore();
  const pairingRequests = createPairingRequestStore();
  const settings = {
    claimMode: overrides.claimMode ?? false,
    trustLan: overrides.trustLan ?? true,
    passwordEnabled: false,
  };
  const revoked: string[] = [];
  let passwordHash: string | null = null;
  const connected = new Set<string>();
  const service = createDeviceAccessService({
    claimStore,
    pairingCodes,
    pairingRequests,
    serverId: "server-1",
    daemonPublicKeyB64: Buffer.from("a-public-key").toString("base64"),
    endpoints: () => [{ host: "192.168.1.10", port: 8790 }],
    deepLinkScheme: "frogg",
    settings: {
      read: () => ({ ...settings }),
      update: async (input) => {
        Object.assign(settings, input);
      },
      setPasswordHash: async (hash) => {
        passwordHash = hash;
        settings.passwordEnabled = hash !== null;
      },
      overrideControlledPaths: () => ["daemon.auth.trustLan"],
    },
    connectedCredentialIds: () => connected,
    onDeviceRevoked: (id) => revoked.push(id),
  });
  const mint = (role: "owner" | "operator" | "viewer", name: string): DeviceRecord => {
    const minted = claimStore.mintPrincipal({ label: name, deviceName: name, role });
    return claimStore.getDevice(minted.credentialId)!;
  };
  return {
    service,
    claimStore,
    pairingRequests,
    mint,
    revoked,
    connected,
    settings,
    passwordHash: () => passwordHash,
  };
}

describe("device access service", () => {
  test("lists devices, marking the caller's own and the connected ones", () => {
    const h = harness();
    const owner = h.mint("owner", "Desk");
    const other = h.mint("operator", "Phone");
    h.connected.add(other.id);

    const devices = h.service.listDevices({ device: owner });
    expect(devices.map((device) => [device.name, device.current, device.connected])).toEqual([
      ["Desk", true, false],
      ["Phone", false, true],
    ]);
  });

  test("a viewer can rename itself but not another device", () => {
    const h = harness();
    const viewer = h.mint("viewer", "Tablet");
    const other = h.mint("operator", "Phone");

    expect(
      h.service.renameDevice({ device: viewer }, { deviceId: viewer.id, name: "My tablet" }).name,
    ).toBe("My tablet");
    expect(() =>
      h.service.renameDevice({ device: viewer }, { deviceId: other.id, name: "Nope" }),
    ).toThrow(DeviceAccessError);
  });

  test("revoking another device needs an owner, and reaches live connections", () => {
    const h = harness();
    const owner = h.mint("owner", "Desk");
    const operator = h.mint("operator", "Phone");

    expect(() => h.service.revokeDevice({ device: { ...operator } }, owner.id)).toThrow(
      DeviceAccessError,
    );
    expect(h.service.revokeDevice({ device: owner }, operator.id)).toBe(true);
    expect(h.revoked).toEqual([operator.id]);
    expect(h.claimStore.getDevice(operator.id)).toBeNull();
  });

  test("signing yourself out does not need the owner role", () => {
    const h = harness();
    const viewer = h.mint("viewer", "Tablet");
    expect(h.service.revokeDevice({ device: viewer }, viewer.id)).toBe(true);
  });

  test("a pairing code carries a role, a fingerprint and a deep link per endpoint", () => {
    const h = harness();
    const owner = h.mint("owner", "Desk");

    const issued = h.service.createPairingCode({ device: owner }, { role: "viewer" });
    expect(issued.role).toBe("viewer");
    expect(issued.fingerprint.startsWith("sha256:")).toBe(true);
    expect(issued.endpoints).toHaveLength(1);

    const link = parseDirectPairingDeepLink(issued.endpoints[0]!.deepLink, "frogg");
    expect(link).not.toBeNull();
    expect(link!.host).toBe("192.168.1.10");
    expect(link!.port).toBe(8790);
    expect(link!.role).toBe("viewer");
    expect(link!.fingerprint).toBe(issued.fingerprint);
    expect(link!.pairingCode).toBe(normalizePairingCode(issued.code));
  });

  test("only an owner can mint an owner code, and a viewer cannot pair at all", () => {
    const h = harness();
    const operator = h.mint("operator", "Phone");
    const viewer = h.mint("viewer", "Tablet");

    expect(() => h.service.createPairingCode({ device: operator }, { role: "owner" })).toThrow(
      DeviceAccessError,
    );
    expect(h.service.createPairingCode({ device: operator }, {}).role).toBe("operator");
    expect(() => h.service.createPairingCode({ device: viewer }, {})).toThrow(DeviceAccessError);
  });

  test("a credential-less caller counts as an owner", () => {
    const h = harness();
    h.mint("operator", "Phone");
    expect(h.service.createPairingCode({ device: null }, { role: "owner" }).role).toBe("owner");
  });

  test("claim mode reports the LAN as untrusted whatever trustLan says", async () => {
    const h = harness({ claimMode: false, trustLan: true });
    expect(h.service.settings().lanTrustEffective).toBe(true);
    const updated = await h.service.updateSettings({ device: null }, { claimMode: true });
    expect(updated.claimMode).toBe(true);
    expect(updated.trustLan).toBe(true);
    expect(updated.lanTrustEffective).toBe(false);
  });

  test("settings changes are owner-only", async () => {
    const h = harness();
    const operator = h.mint("operator", "Phone");
    await expect(
      h.service.updateSettings({ device: operator }, { trustLan: false }),
    ).rejects.toThrow(DeviceAccessError);
    await expect(h.service.setPassword({ device: operator }, "hunter22")).rejects.toThrow(
      DeviceAccessError,
    );
  });

  test("a short password is refused and a null password turns passwords off", async () => {
    const h = harness();
    await expect(h.service.setPassword({ device: null }, "short")).rejects.toThrow(
      DeviceAccessError,
    );
    expect(h.passwordHash()).toBeNull();
    const enabled = await h.service.setPassword({ device: null }, "long-enough");
    expect(enabled.passwordEnabled).toBe(true);
    expect(h.passwordHash()).not.toBeNull();
    const disabled = await h.service.setPassword({ device: null }, null);
    expect(disabled.passwordEnabled).toBe(false);
    expect(h.passwordHash()).toBeNull();
  });

  test("deciding a pending request approves it for collection", () => {
    const h = harness();
    const created = h.pairingRequests.create({ deviceName: "Phone", remoteAddress: "10.0.0.5" });
    expect(h.service.listPairingRequests()).toHaveLength(1);
    h.service.decidePairingRequest(
      { device: null },
      {
        pairingRequestId: created!.id,
        decision: "approve",
        role: "operator",
      },
    );
    expect(h.service.listPairingRequests()).toHaveLength(0);
    expect(h.pairingRequests.poll(created!.pollId)?.status).toBe("approved");
  });

  test("an unknown pairing request is an error", () => {
    const h = harness();
    expect(() =>
      h.service.decidePairingRequest(
        { device: null },
        {
          pairingRequestId: "missing",
          decision: "deny",
        },
      ),
    ).toThrow(DeviceAccessError);
  });
});
