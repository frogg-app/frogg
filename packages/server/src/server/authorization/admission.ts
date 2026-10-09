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
  device?: { id: string; name: string; role: DeviceRole } | null;
  role?: DeviceRole;
  transport?: SessionTransport;
  /**
   * Admitted on locality alone. No transport admits on locality any more; the
   * field stays for the owner-offer gate and is always false for real sockets.
   */
  localityTrusted?: boolean;
  /**
   * Admitted on a shared secret (password or local token) rather than a device
   * credential: the session is bound to a device registered by its hello
   * clientId before it is created.
   */
  registerVia?: "password" | "local";
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
 * principal, permissions and role; the daemon password and the local token keep
 * owner authority and are registered as a device at hello.
 */
export function admissionForPrincipal(
  principal: BearerPrincipal,
  transport: SessionTransport = "direct",
): PrincipalAdmission {
  if (principal.kind !== "device") {
    return {
      principalId: "owner",
      permissions: OWNER_PERMISSIONS,
      transport,
      registerVia: principal.kind === "password" ? "password" : "local",
    };
  }
  const { device } = principal;
  return {
    principalId: device.principalId,
    // A device record without its own grant is a legacy pairing: full authority,
    // narrowed by its role (legacy pairings migrate to owner).
    permissions: device.permissions.length > 0 ? device.permissions : OWNER_PERMISSIONS,
    device: { id: device.id, name: device.name, role: device.role },
    transport,
  };
}
