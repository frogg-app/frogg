import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useSessionStore } from "@/stores/session-store";
import {
  readDeviceAccessCapabilities,
  resolveDeviceAccessPermissions,
  type DeviceAccessCapabilities,
  type DeviceAccessPermissions,
} from "./capabilities";

/**
 * The single gate for every device-access surface: what the daemon advertises
 * and what this device's own role allows. Reading both from one place is what
 * keeps a hidden button and a refused RPC from disagreeing.
 */
export function useDeviceAccess(serverId: string | null | undefined): DeviceAccessCapabilities &
  DeviceAccessPermissions {
  const normalized = serverId?.trim() ?? "";
  const raw = useSessionStore(
    useShallow((state) => {
      const info = state.sessions[normalized]?.serverInfo ?? null;
      return {
        present: info !== null,
        deviceAccess: info?.features?.deviceAccess === true,
        deviceRoles: info?.features?.deviceRoles === true,
        deviceRoleManagement: info?.features?.deviceRoleManagement === true,
        sessionPresence: info?.features?.sessionPresence === true,
        callerRole: info?.callerRole,
        deviceId: info?.device?.id,
        deviceName: info?.device?.name,
        deviceRole: info?.device?.role,
      };
    }),
  );

  return useMemo(() => {
    const capabilities = readDeviceAccessCapabilities(
      raw.present
        ? {
            serverId: normalized,
            hostname: null,
            version: null,
            features: {
              deviceAccess: raw.deviceAccess,
              deviceRoles: raw.deviceRoles,
              deviceRoleManagement: raw.deviceRoleManagement,
              sessionPresence: raw.sessionPresence,
            },
            ...(raw.callerRole ? { callerRole: raw.callerRole } : {}),
            ...(raw.deviceId !== undefined && raw.deviceName !== undefined && raw.deviceRole
              ? { device: { id: raw.deviceId, name: raw.deviceName, role: raw.deviceRole } }
              : {}),
          }
        : null,
    );
    return { ...capabilities, ...resolveDeviceAccessPermissions(capabilities) };
  }, [
    normalized,
    raw.callerRole,
    raw.deviceAccess,
    raw.deviceRoleManagement,
    raw.deviceId,
    raw.deviceName,
    raw.deviceRole,
    raw.deviceRoles,
    raw.present,
    raw.sessionPresence,
  ]);
}
