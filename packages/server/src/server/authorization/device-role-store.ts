import { LastOwnerError } from "../claim-store.js";
import type { DeviceRole } from "./roles.js";

/**
 * Persisted role per paired-device credential. Backed by the claim store's
 * per-credential `role` (records without one read as owner); kept behind this
 * interface so authorization does not depend on the storage format.
 */
export interface DeviceRoleStore {
  getRole(credentialId: string): DeviceRole | null;
  /**
   * Returns false when the credential does not exist. Throws when the change
   * would demote the last owner.
   */
  setRole(credentialId: string, role: DeviceRole): Promise<boolean>;
}

/** Adapter for a synchronous store such as ClaimStore's credential-role methods. */
export function deviceRoleStoreFrom(source: {
  getCredentialRole(credentialId: string): DeviceRole | null;
  setCredentialRole(credentialId: string, role: DeviceRole): boolean;
  isLastOwner?(credentialId: string): boolean;
}): DeviceRoleStore {
  return {
    getRole: (credentialId) => source.getCredentialRole(credentialId),
    setRole: async (credentialId, role) => {
      if (role !== "owner" && source.isLastOwner?.(credentialId)) throw new LastOwnerError();
      return source.setCredentialRole(credentialId, role);
    },
  };
}

/** In-memory store for tests and daemons without a claim store. */
export function createMemoryDeviceRoleStore(
  initial: Record<string, DeviceRole> = {},
): DeviceRoleStore {
  const roles = new Map(Object.entries(initial));
  return {
    getRole: (credentialId) => roles.get(credentialId) ?? null,
    setRole: async (credentialId, role) => {
      if (!roles.has(credentialId)) return false;
      roles.set(credentialId, role);
      return true;
    },
  };
}
