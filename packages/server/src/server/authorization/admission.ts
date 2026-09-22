import type { DaemonPermission } from "@frogg/protocol/messages";
import type { BearerPrincipal } from "../auth.js";
import { OWNER_PERMISSIONS } from "./index.js";
import { defaultRoleForTransport, type DeviceRole, type SessionTransport } from "./roles.js";

/**
 * What a connection is allowed to do, decided once at admission and carried by
 * its Session. Transports that know nothing about the caller fall back to the
 * transport's declared role rather than to owner.
 */
export interface PrincipalAdmission {
  principalId: string;
  permissions: readonly DaemonPermission[];
  device?: { credentialId: string; name: string; role: DeviceRole };
  role?: DeviceRole;
  transport?: SessionTransport;
}

/** The single place a connection's role is decided, for every transport. */
export function resolveAdmissionRole(admission: PrincipalAdmission): DeviceRole {
  return (
    admission.role ??
    admission.device?.role ??
    defaultRoleForTransport(admission.transport ?? "direct")
  );
}

/**
 * The admission for an authenticated connection. A paired device brings its own
 * principal, permissions and role; the daemon password and bearer-free trusted
 * clients (loopback, trusted LAN) keep the owner authority they have always had.
 */
export function admissionForPrincipal(
  principal: BearerPrincipal,
  transport: SessionTransport = "direct",
): PrincipalAdmission {
  if (principal.kind !== "device") {
    return { principalId: "owner", permissions: OWNER_PERMISSIONS, transport };
  }
  const { device } = principal;
  return {
    principalId: device.principalId,
    // A device record without its own grant is a legacy pairing: full authority,
    // narrowed by its role (legacy pairings migrate to owner).
    permissions: device.permissions.length > 0 ? device.permissions : OWNER_PERMISSIONS,
    device: { credentialId: device.id, name: device.name, role: device.role },
    transport,
  };
}
