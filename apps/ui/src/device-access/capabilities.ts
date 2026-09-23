import type { DeviceRole } from "@frogg/protocol/device-access";
import type { DaemonServerInfo } from "@/stores/session-store";

/**
 * What the connected daemon offers, and what this device is allowed to do with
 * it. Every device-access surface reads its gate from here so the app and the
 * daemon cannot disagree about who may do what.
 *
 * A connection with no device credential (loopback, or a trusted LAN) reports
 * no `callerRole`. The daemon treats that connection as an owner, because it
 * already has unrestricted access, so the UI has to as well — see
 * `callerRole` in `device-access-service.ts`.
 */

export const DEFAULT_CALLER_ROLE: DeviceRole = "owner";

export interface DeviceAccessCapabilities {
  /** `features.deviceAccess`: devices can be listed, renamed and revoked. */
  devices: boolean;
  /** `features.deviceRoles`: this daemon understands owner/operator/viewer. */
  roles: boolean;
  /** `features.deviceRoleManagement`: a role can be changed from here. */
  roleManagement: boolean;
  /** `features.sessionPresence`. */
  presence: boolean;
  /** The role the daemon enforces for this connection. */
  callerRole: DeviceRole;
  /** False while no handshake has arrived: "unknown", not "viewer". */
  handshakeSeen: boolean;
  /** This connection carries a device credential of its own. */
  hasDeviceCredential: boolean;
}

export function readDeviceAccessCapabilities(
  serverInfo: DaemonServerInfo | null | undefined,
): DeviceAccessCapabilities {
  const features = serverInfo?.features;
  const callerRole = serverInfo?.callerRole;
  return {
    devices: features?.deviceAccess === true,
    roles: features?.deviceRoles === true,
    roleManagement: features?.deviceRoleManagement === true,
    presence: features?.sessionPresence === true,
    callerRole: callerRole ?? DEFAULT_CALLER_ROLE,
    handshakeSeen: Boolean(serverInfo),
    hasDeviceCredential: callerRole !== undefined,
  };
}

/** Every action a device-access surface gates on, resolved once. */
export interface DeviceAccessPermissions {
  /** Show the devices list at all. */
  canViewDevices: boolean;
  canRenameDevice: boolean;
  canRevokeDevice: boolean;
  canChangeRole: boolean;
  canCreatePairingCode: boolean;
  /** Owner codes specifically; a non-owner cannot mint one. */
  canCreateOwnerPairingCode: boolean;
  canDecidePairingRequests: boolean;
  canEditAuthSettings: boolean;
}

export function resolveDeviceAccessPermissions(
  capabilities: DeviceAccessCapabilities,
): DeviceAccessPermissions {
  const owner = capabilities.callerRole === "owner";
  const managing = capabilities.devices && owner;
  return {
    canViewDevices: capabilities.devices,
    canRenameDevice: managing,
    canRevokeDevice: managing,
    // Role changes additionally need the daemon to have a role store wired up.
    canChangeRole: managing && capabilities.roleManagement,
    canCreatePairingCode: managing,
    canCreateOwnerPairingCode: managing,
    canDecidePairingRequests: managing,
    canEditAuthSettings: managing,
  };
}

/**
 * Why an action is unavailable, so the UI can say so instead of hiding a
 * button or letting the daemon reject the click.
 */
export type DeviceAccessRefusal =
  /** The daemon predates the feature. */
  | "unsupported"
  /** The daemon is reachable but has not finished its handshake. */
  | "unknown"
  /** This device's role is too low. */
  | "role";

export function describeRefusal(
  capabilities: DeviceAccessCapabilities,
  allowed: boolean,
): DeviceAccessRefusal | null {
  if (allowed) return null;
  if (!capabilities.handshakeSeen) return "unknown";
  if (!capabilities.devices) return "unsupported";
  return "role";
}

export const DEVICE_ROLE_ORDER: readonly DeviceRole[] = ["owner", "operator", "viewer"];

/** True when `role` is at least `minimum` — the daemon's own ordering. */
export function roleAtLeast(role: DeviceRole, minimum: DeviceRole): boolean {
  return DEVICE_ROLE_ORDER.indexOf(role) <= DEVICE_ROLE_ORDER.indexOf(minimum);
}

/** Owners in a device list; used to warn before the last one is removed. */
export function countOwners(devices: readonly { role: DeviceRole }[]): number {
  return devices.filter((device) => device.role === "owner").length;
}

/**
 * The daemon has no last-owner guard: revoking or demoting the only owner
 * leaves nobody who can manage the daemon short of `reset-claim` on its own
 * machine. The UI warns rather than blocking, because a loopback shell is
 * still an owner and the user may mean it.
 */
export function leavesNoOwner(
  devices: readonly { id: string; role: DeviceRole }[],
  change: { deviceId: string; nextRole: DeviceRole | "revoked" },
): boolean {
  const after = devices
    .map((device) =>
      device.id === change.deviceId
        ? change.nextRole === "revoked"
          ? null
          : { ...device, role: change.nextRole }
        : device,
    )
    .filter((device): device is { id: string; role: DeviceRole } => device !== null);
  return countOwners(devices) > 0 && countOwners(after) === 0;
}
