import { useCallback, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AuthPairingCodeCreateResponse } from "@frogg/protocol/device-access-rpc";
import type { DeviceRole } from "@frogg/protocol/device-access";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { i18n } from "@/i18n/i18next";

type PairingCodePayload = AuthPairingCodeCreateResponse["payload"];

export interface MintedPairingCode {
  code: string;
  expiresAt: string;
  role: DeviceRole;
  serverId: string;
  fingerprint: string;
  endpoints: PairingCodePayload["endpoints"];
  /** The best-guess endpoint's deep link, which is what the QR encodes. */
  deepLink: string | null;
}

export interface PairingCodeMint {
  code: MintedPairingCode | null;
  mint: (input?: { role?: DeviceRole; ttlSeconds?: number }) => Promise<void>;
  isPending: boolean;
  error: Error | null;
  /** Forgets the code without revoking it; it still expires on its own. */
  clear: () => void;
}

/**
 * Minting a pairing code is a deliberate, owner-only act, so it is a mutation
 * with a result the caller holds, never a query that would re-mint a code on a
 * refetch.
 */
export function usePairingCode(serverId: string): PairingCodeMint {
  const client = useHostRuntimeClient(serverId);
  const [code, setCode] = useState<MintedPairingCode | null>(null);

  const mutation = useMutation({
    mutationFn: async (input: { role?: DeviceRole; ttlSeconds?: number } = {}) => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.createPairingCode(input);
      if (payload.error) throw new Error(payload.error);
      if (!payload.code || !payload.expiresAt || !payload.role) {
        throw new Error(i18n.t("deviceAccess.errors.noPairingCode"));
      }
      return {
        code: payload.code,
        expiresAt: payload.expiresAt,
        role: payload.role,
        serverId: payload.serverId,
        fingerprint: payload.fingerprint,
        endpoints: payload.endpoints,
        deepLink: payload.endpoints[0]?.deepLink ?? null,
      } satisfies MintedPairingCode;
    },
    onSuccess: setCode,
  });

  const mint = useCallback(
    async (input: { role?: DeviceRole; ttlSeconds?: number } = {}) => {
      await mutation.mutateAsync(input);
    },
    [mutation],
  );

  const clear = useCallback(() => setCode(null), []);

  return useMemo(
    () => ({ code, mint, isPending: mutation.isPending, error: mutation.error, clear }),
    [clear, code, mint, mutation.error, mutation.isPending],
  );
}

/** Seconds left before a minted code expires; 0 once it has. */
export function pairingCodeSecondsRemaining(expiresAt: string, now: number = Date.now()): number {
  const parsed = Date.parse(expiresAt);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round((parsed - now) / 1000));
}
