import { describe, expect, it } from "vitest";
import type { DaemonServerInfo } from "@/stores/session-store";
import {
  countOwners,
  describeRefusal,
  leavesNoOwner,
  readDeviceAccessCapabilities,
  resolveDeviceAccessPermissions,
  roleAtLeast,
} from "./capabilities";

function serverInfo(overrides: Partial<DaemonServerInfo> = {}): DaemonServerInfo {
  return {
    serverId: "server-1",
    hostname: "host",
    version: "1.6.0",
    features: {
      deviceAccess: true,
      deviceRoles: true,
      deviceRoleManagement: true,
      sessionPresence: true,
    },
    ...overrides,
  };
}

describe("readDeviceAccessCapabilities", () => {
  it("treats a credential-less connection as an owner, like the daemon does", () => {
    const capabilities = readDeviceAccessCapabilities(serverInfo());
    expect(capabilities.callerRole).toBe("owner");
    expect(capabilities.hasDeviceCredential).toBe(false);
    expect(capabilities.handshakeSeen).toBe(true);
  });

  it("reports the role the daemon enforces when one is sent", () => {
    const capabilities = readDeviceAccessCapabilities(serverInfo({ callerRole: "viewer" }));
    expect(capabilities.callerRole).toBe("viewer");
    expect(capabilities.hasDeviceCredential).toBe(true);
  });

  it("distinguishes no handshake from an unsupported daemon", () => {
    expect(readDeviceAccessCapabilities(null).handshakeSeen).toBe(false);
    expect(readDeviceAccessCapabilities(serverInfo({ features: {} })).handshakeSeen).toBe(true);
    expect(readDeviceAccessCapabilities(serverInfo({ features: {} })).devices).toBe(false);
  });
});

describe("resolveDeviceAccessPermissions", () => {
  it("lets an owner manage everything the daemon advertises", () => {
    const permissions = resolveDeviceAccessPermissions(readDeviceAccessCapabilities(serverInfo()));
    expect(permissions).toMatchObject({
      canViewDevices: true,
      canRevokeDevice: true,
      canChangeRole: true,
      canCreatePairingCode: true,
      canDecidePairingRequests: true,
    });
  });

  it("lets an operator see devices but change nothing", () => {
    const permissions = resolveDeviceAccessPermissions(
      readDeviceAccessCapabilities(serverInfo({ callerRole: "operator" })),
    );
    expect(permissions.canViewDevices).toBe(true);
    expect(permissions.canRevokeDevice).toBe(false);
    expect(permissions.canChangeRole).toBe(false);
    expect(permissions.canCreatePairingCode).toBe(false);
    expect(permissions.canDecidePairingRequests).toBe(false);
  });

  it("gives a viewer the same read-only view as an operator", () => {
    const permissions = resolveDeviceAccessPermissions(
      readDeviceAccessCapabilities(serverInfo({ callerRole: "viewer" })),
    );
    expect(permissions.canViewDevices).toBe(true);
    expect(permissions.canRenameDevice).toBe(false);
  });

  it("hides role changes when the daemon has no role store", () => {
    const capabilities = readDeviceAccessCapabilities(
      serverInfo({
        features: { deviceAccess: true, deviceRoles: true, deviceRoleManagement: false },
      }),
    );
    const permissions = resolveDeviceAccessPermissions(capabilities);
    expect(permissions.canRevokeDevice).toBe(true);
    expect(permissions.canChangeRole).toBe(false);
  });
});

describe("describeRefusal", () => {
  it("names the reason an action is unavailable", () => {
    expect(describeRefusal(readDeviceAccessCapabilities(serverInfo()), true)).toBeNull();
    expect(describeRefusal(readDeviceAccessCapabilities(null), false)).toBe("unknown");
    expect(describeRefusal(readDeviceAccessCapabilities(serverInfo({ features: {} })), false)).toBe(
      "unsupported",
    );
    expect(
      describeRefusal(readDeviceAccessCapabilities(serverInfo({ callerRole: "viewer" })), false),
    ).toBe("role");
  });
});

describe("role ordering and the last owner", () => {
  it("orders owner above operator above viewer", () => {
    expect(roleAtLeast("owner", "viewer")).toBe(true);
    expect(roleAtLeast("operator", "operator")).toBe(true);
    expect(roleAtLeast("viewer", "operator")).toBe(false);
  });

  it("counts owners", () => {
    expect(countOwners([{ role: "owner" }, { role: "viewer" }, { role: "owner" }])).toBe(2);
  });

  it("warns when revoking the last owner", () => {
    const devices = [
      { id: "a", role: "owner" as const },
      { id: "b", role: "operator" as const },
    ];
    expect(leavesNoOwner(devices, { deviceId: "a", nextRole: "revoked" })).toBe(true);
    expect(leavesNoOwner(devices, { deviceId: "b", nextRole: "revoked" })).toBe(false);
  });

  it("warns when demoting the last owner", () => {
    const devices = [{ id: "a", role: "owner" as const }];
    expect(leavesNoOwner(devices, { deviceId: "a", nextRole: "viewer" })).toBe(true);
    expect(leavesNoOwner(devices, { deviceId: "a", nextRole: "owner" })).toBe(false);
  });

  it("stays quiet when another owner remains", () => {
    const devices = [
      { id: "a", role: "owner" as const },
      { id: "b", role: "owner" as const },
    ];
    expect(leavesNoOwner(devices, { deviceId: "a", nextRole: "revoked" })).toBe(false);
  });
});
