import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import { DAEMON_PERMISSIONS, type DaemonPermission } from "@frogg/protocol/messages";
import {
  requiredPermissionForInbound,
  requiredPermissionForOutbound,
} from "./operation-permissions.js";
import {
  minimumRoleForPermission,
  requiredRoleForInbound,
  requiredRoleForOutbound,
  roleSatisfies,
  type DeviceRole,
} from "./roles.js";

export {
  DEVICE_ROLES,
  SESSION_TRANSPORTS,
  defaultRoleForTransport,
  isDeviceRole,
  minimumRoleForPermission,
  type SessionTransport,
  requiredRoleForInbound,
  roleSatisfies,
  type DeviceRole,
} from "./roles.js";

export { DAEMON_PERMISSIONS, type DaemonPermission };

const daemonPermissionSet: ReadonlySet<string> = new Set(DAEMON_PERMISSIONS);

export function isDaemonPermission(value: string): value is DaemonPermission {
  return daemonPermissionSet.has(value);
}

export function parseDaemonPermissions(values: readonly string[]): DaemonPermission[] {
  const permissions = [...new Set(values)];
  if (!permissions.every(isDaemonPermission)) throw new Error("Invalid daemon permission");
  return permissions;
}

export const OWNER_PERMISSIONS: readonly DaemonPermission[] = DAEMON_PERMISSIONS;

/**
 * A session's authority: the permissions its principal was granted, narrowed by
 * the connecting device's role. A request passes when its permission is granted
 * and the role meets the RPC's declared role. Absent a device role (loopback,
 * password, Hub, legacy pairings) the session is `owner` and permissions alone
 * decide.
 */
export class SessionAuthorization {
  private permissions: ReadonlySet<DaemonPermission>;
  private role: DeviceRole;

  constructor(permissions: readonly DaemonPermission[], role: DeviceRole = "owner") {
    this.permissions = new Set(permissions);
    this.role = role;
  }

  allowsInbound(message: SessionInboundMessage): boolean {
    return (
      this.hasPermission(requiredPermissionForInbound(message.type)) &&
      roleSatisfies(this.role, requiredRoleForInbound(message.type))
    );
  }

  allowsOutbound(message: SessionOutboundMessage): boolean {
    const permission = requiredPermissionForOutbound(message.type);
    return (
      this.hasPermission(permission) &&
      roleSatisfies(this.role, requiredRoleForOutbound(message.type, permission))
    );
  }

  replacePermissions(permissions: readonly DaemonPermission[]): void {
    this.permissions = new Set(permissions);
  }

  replaceRole(role: DeviceRole): void {
    this.role = role;
  }

  getRole(): DeviceRole {
    return this.role;
  }

  /** Effective permissions: granted and reachable by the current role. */
  listPermissions(): DaemonPermission[] {
    return [...this.permissions].filter((permission) => this.allowsPermission(permission));
  }

  allowsPermission(permission: DaemonPermission): boolean {
    return (
      this.permissions.has(permission) &&
      roleSatisfies(this.role, minimumRoleForPermission(permission))
    );
  }

  private hasPermission(permission: DaemonPermission | null): boolean {
    return permission === null || this.permissions.has(permission);
  }
}

const LEGACY_HUB_EXECUTION_SCOPE = "hub.execution.*";

export function permissionsForLegacyHubScopes(
  scopes: readonly string[],
): readonly DaemonPermission[] {
  // COMPAT(semanticHubPermissions): added in v0.7, remove after Hub enrollment uses permissions.
  return scopes.includes(LEGACY_HUB_EXECUTION_SCOPE) ? ["hub.execute"] : [];
}
