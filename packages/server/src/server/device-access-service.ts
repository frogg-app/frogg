import {
  DEVICE_NAME_MAX_LENGTH,
  daemonKeyFingerprint,
  formatPairingCode,
  buildDirectPairingDeepLink,
  type AuthSettings,
  type DeviceCredential,
  type DeviceRole,
  type PendingPairingRequest,
} from "@frogg/protocol/device-access";
import type { PairingEndpointSchema } from "@frogg/protocol/device-access-rpc";
import type { z } from "zod";

import type { ClaimStore, DeviceRecord } from "./claim-store.js";
import type { PairingCodeStore } from "./pairing-code-store.js";
import type { PairingRequestStore } from "./pairing-request-store.js";
import { DAEMON_PASSWORD_MIN_LENGTH, hashDaemonPassword } from "./auth.js";

/**
 * The device-access session RPCs (`auth.*` in device-access-rpc.ts) in one
 * place, so session.ts only marshals messages. Every method here assumes the
 * caller already passed the `access.manage` permission check; the extra rules
 * enforced here are the ones about *which* device is asking (only an owner can
 * hand out owner, and a viewer can never escalate itself).
 */
export type PairingEndpoint = z.infer<typeof PairingEndpointSchema>;

/** What the access rules need to know about the calling device. */
export interface CallerDevice {
  id: string;
  name: string;
  role: DeviceRole;
}

export interface DeviceAccessCaller {
  /** The paired device this connection authenticated as, if any. */
  device: CallerDevice | null;
}

export interface DeviceAccessServiceOptions {
  claimStore: ClaimStore;
  pairingCodes: PairingCodeStore;
  pairingRequests: PairingRequestStore;
  serverId: string;
  daemonPublicKeyB64: string;
  /** Reachable `host:port` pairs, best guess first. */
  endpoints: () => { host: string; port: number; useTls?: boolean }[];
  deepLinkScheme: string;
  settings: {
    read(): { claimMode: boolean; trustLan: boolean; passwordEnabled: boolean };
    /** Persists `daemon.auth.*`; returns the settings as they now stand. */
    update(input: { claimMode?: boolean; trustLan?: boolean }): Promise<void>;
    setPasswordHash(hash: string | null): Promise<void>;
    overrideControlledPaths(): string[];
  };
  /** Connections currently using a credential, for `connected` and revocation. */
  connectedCredentialIds: () => ReadonlySet<string>;
  onDeviceRevoked?: (credentialId: string) => void;
  onSettingsChanged?: () => void;
}

export class DeviceAccessError extends Error {}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > DEVICE_NAME_MAX_LENGTH) {
    throw new DeviceAccessError("Invalid device name");
  }
  return trimmed;
}

export function createDeviceAccessService(options: DeviceAccessServiceOptions) {
  const {
    claimStore,
    pairingCodes,
    pairingRequests,
    connectedCredentialIds,
    settings: settingsStore,
  } = options;

  function fingerprint(): string {
    return daemonKeyFingerprint(options.daemonPublicKeyB64);
  }

  function toCredential(device: DeviceRecord, caller: DeviceAccessCaller): DeviceCredential {
    return {
      id: device.id,
      name: device.name,
      role: device.role,
      principalId: device.principalId,
      createdAt: device.createdAt,
      lastSeenAt: device.lastSeenAt,
      ...(device.pairedVia ? { pairedVia: device.pairedVia } : {}),
      current: caller.device?.id === device.id,
      connected: connectedCredentialIds().has(device.id),
    };
  }

  /**
   * A credential-less connection (loopback, or the trusted LAN) counts as an
   * owner: it already has unrestricted access to the daemon, so refusing it
   * here would only lock the operator out of their own access settings.
   */
  function callerRole(caller: DeviceAccessCaller): DeviceRole {
    return caller.device?.role ?? "owner";
  }

  function requireOwner(caller: DeviceAccessCaller): void {
    if (callerRole(caller) !== "owner") {
      throw new DeviceAccessError("Only an owner device can do that");
    }
  }

  function settings(): AuthSettings {
    const current = settingsStore.read();
    return {
      claimMode: current.claimMode,
      trustLan: current.trustLan,
      // Claim mode untrusts the LAN whatever `trustLan` says.
      lanTrustEffective: current.trustLan && !current.claimMode,
      claimed: claimStore.isClaimed(),
      passwordEnabled: current.passwordEnabled,
      overrideControlledPaths: settingsStore.overrideControlledPaths(),
      deviceCount: claimStore.listDevices().length,
    };
  }

  return {
    settings,
    fingerprint,
    serverId: options.serverId,

    listDevices: (caller: DeviceAccessCaller): DeviceCredential[] =>
      claimStore.listDevices().map((device) => toCredential(device, caller)),

    renameDevice: (
      caller: DeviceAccessCaller,
      input: { deviceId: string; name: string },
    ): DeviceCredential => {
      const target = claimStore.getDevice(input.deviceId);
      if (!target) throw new DeviceAccessError("Unknown device");
      // Renaming another device is an owner action; renaming your own is not.
      if (target.id !== caller.device?.id) requireOwner(caller);
      const renamed = claimStore.renameDevice(input.deviceId, assertName(input.name));
      if (!renamed) throw new DeviceAccessError("Unknown device");
      return toCredential(renamed, caller);
    },

    revokeDevice: (caller: DeviceAccessCaller, deviceId: string): boolean => {
      const target = claimStore.getDevice(deviceId);
      if (!target) return false;
      // Signing yourself out is always allowed; removing someone else is not.
      if (target.id !== caller.device?.id) requireOwner(caller);
      const revoked = claimStore.revokeDevice(deviceId);
      // Revocation has to reach live connections, or the removed device keeps
      // its session until it happens to reconnect.
      if (revoked) options.onDeviceRevoked?.(deviceId);
      return revoked;
    },

    createPairingCode: (
      caller: DeviceAccessCaller,
      input: { role?: DeviceRole; ttlSeconds?: number },
    ) => {
      const role = input.role ?? "operator";
      // A code can never hand out more than the device that created it has.
      if (role === "owner") requireOwner(caller);
      if (callerRole(caller) === "viewer") {
        throw new DeviceAccessError("A viewer device cannot pair other devices");
      }
      const issued = pairingCodes.issue({ role, ttlSeconds: input.ttlSeconds });
      const endpoints: PairingEndpoint[] = options.endpoints().map((endpoint) => ({
        host: endpoint.host,
        port: endpoint.port,
        deepLink: buildDirectPairingDeepLink(
          {
            host: endpoint.host,
            port: endpoint.port,
            fingerprint: fingerprint(),
            pairingCode: issued.code,
            ...(endpoint.useTls ? { useTls: true } : {}),
            serverId: options.serverId,
            role,
          },
          options.deepLinkScheme,
        ),
      }));
      return {
        code: formatPairingCode(issued.code),
        expiresAt: issued.expiresAt,
        role,
        serverId: options.serverId,
        fingerprint: fingerprint(),
        endpoints,
      };
    },

    listPairingRequests: (): PendingPairingRequest[] => pairingRequests.list(),

    decidePairingRequest: (
      caller: DeviceAccessCaller,
      input: {
        pairingRequestId: string;
        decision: "approve" | "deny";
        role?: DeviceRole;
        name?: string;
      },
    ): null => {
      if (input.decision === "approve") {
        if ((input.role ?? "operator") === "owner") requireOwner(caller);
        if (callerRole(caller) === "viewer") {
          throw new DeviceAccessError("A viewer device cannot approve pairing requests");
        }
      }
      const decided = pairingRequests.decide({
        id: input.pairingRequestId,
        decision: input.decision,
        ...(input.role ? { role: input.role } : {}),
        ...(input.name ? { name: assertName(input.name) } : {}),
      });
      if (!decided) throw new DeviceAccessError("Unknown or expired pairing request");
      // The credential is minted when the waiting device collects the approval,
      // so there is nothing to return here.
      return null;
    },

    updateSettings: async (
      caller: DeviceAccessCaller,
      input: { claimMode?: boolean; trustLan?: boolean },
    ): Promise<AuthSettings> => {
      requireOwner(caller);
      await settingsStore.update(input);
      options.onSettingsChanged?.();
      return settings();
    },

    setPassword: async (
      caller: DeviceAccessCaller,
      password: string | null,
    ): Promise<AuthSettings> => {
      requireOwner(caller);
      if (password !== null && password.length < DAEMON_PASSWORD_MIN_LENGTH) {
        throw new DeviceAccessError(
          `The password must be at least ${DAEMON_PASSWORD_MIN_LENGTH} characters`,
        );
      }
      await settingsStore.setPasswordHash(password === null ? null : hashDaemonPassword(password));
      options.onSettingsChanged?.();
      return settings();
    },
  };
}

export type DeviceAccessService = ReturnType<typeof createDeviceAccessService>;
