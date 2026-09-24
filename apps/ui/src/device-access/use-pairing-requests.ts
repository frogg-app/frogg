import { useCallback, useEffect, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DeviceRole, PendingPairingRequest } from "@frogg/protocol/device-access";
import { useReplicaQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { i18n } from "@/i18n/i18next";
import { useRefreshSecurityPosture } from "@/security/use-security-posture";
import { devicesQueryKey, pairingRequestsQueryKey } from "./query-keys";
import { useDeviceAccess } from "./use-device-access";

/**
 * Devices waiting for an owner to let them in. The daemon pushes
 * `auth.pairing_request.update` whenever the pending set changes, so this is a
 * replica of daemon state rather than something to poll: the only fetch is the
 * first snapshot and the one after a reconnect.
 */
export interface PairingRequestsView {
  requests: readonly PendingPairingRequest[];
  isLoading: boolean;
  error: Error | null;
  isEmpty: boolean;
  refetch: () => void;
}

export function usePairingRequests(serverId: string): PairingRequestsView {
  const client = useHostRuntimeClient(serverId);
  const snapshot = useHostRuntimeSnapshot(serverId);
  const isConnected = snapshot?.connectionStatus === "online";
  const access = useDeviceAccess(serverId);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => pairingRequestsQueryKey(serverId), [serverId]);
  const enabled = access.canDecidePairingRequests && Boolean(client) && isConnected;

  const query = useReplicaQuery({
    queryKey,
    queryFn: async () => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.listPairingRequests();
      if (payload.error) throw new Error(payload.error);
      return payload.requests;
    },
    enabled,
    pushEvent: "auth.pairing_request.update",
    retry: 1,
  });

  // Narrow subscription: one message type, not the whole event stream.
  useEffect(() => {
    if (!client || !enabled) return;
    return client.on("auth.pairing_request.update", (message) => {
      queryClient.setQueryData<PendingPairingRequest[]>(queryKey, [...message.payload.requests]);
    });
  }, [client, enabled, queryClient, queryKey]);

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return useMemo(
    () => ({
      requests: query.data ?? [],
      isLoading: query.isPending && query.fetchStatus !== "idle",
      error: query.error,
      isEmpty: query.data !== undefined && query.data.length === 0,
      refetch,
    }),
    [query.data, query.error, query.fetchStatus, query.isPending, refetch],
  );
}

export interface PairingRequestDecision {
  pairingRequestId: string;
  decision: "approve" | "deny";
  role?: DeviceRole;
  name?: string;
}

export interface PairingRequestMutations {
  decide: (input: PairingRequestDecision) => Promise<void>;
  /** The request currently being decided, so only its own row shows pending. */
  pendingRequestId: string | null;
  error: Error | null;
}

export function usePairingRequestMutations(serverId: string): PairingRequestMutations {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const { refresh: refreshSecurityPosture } = useRefreshSecurityPosture(serverId);

  const decide = useMutation({
    mutationFn: async (input: PairingRequestDecision) => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.decidePairingRequest(input);
      if (payload.error) throw new Error(payload.error);
      return input;
    },
    onSuccess: (input) => {
      queryClient.setQueryData<PendingPairingRequest[]>(
        pairingRequestsQueryKey(serverId),
        (previous) => previous?.filter((request) => request.id !== input.pairingRequestId),
      );
      // An approval mints a credential, so the device list is now out of date.
      if (input.decision === "approve") {
        void queryClient.invalidateQueries({ queryKey: devicesQueryKey(serverId) });
        // A first approval claims the daemon, which does not re-send server_info for it.
        void refreshSecurityPosture();
      }
    },
  });

  return useMemo(
    () => ({
      decide: async (input) => {
        await decide.mutateAsync(input);
      },
      pendingRequestId: decide.isPending ? (decide.variables?.pairingRequestId ?? null) : null,
      error: decide.error,
    }),
    [decide],
  );
}
