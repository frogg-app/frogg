import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { ProviderUpdateEntry, ProviderUpdatePreferences } from "@frogg/protocol/messages";

// Provider releases are not frequent enough to warrant a tighter window, and the
// daemon caches the registry lookup behind this anyway.
const PROVIDER_UPDATES_STALE_TIME_MS = 30 * 60 * 1000;
// A global install can legitimately take minutes on a cold npm cache.
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

export function providerUpdatesQueryKey(serverId: string | null | undefined) {
  return ["providerUpdates", serverId ?? ""] as const;
}

export interface ProviderUpdatesState {
  entries: ProviderUpdateEntry[];
  preferences: ProviderUpdatePreferences | null;
  checkedAt: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  /** Provider id currently being installed, if any. */
  installingProvider: string | null;
  supported: boolean;
  refresh: () => Promise<void>;
  install: (provider: string) => Promise<void>;
  setPreferences: (patch: Partial<ProviderUpdatePreferences>) => Promise<void>;
}

export function useProviderUpdates(serverId: string | null | undefined): ProviderUpdatesState {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supported = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.providerUpdates === true,
  );
  const [installingProvider, setInstallingProvider] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const queryKey = useMemo(() => providerUpdatesQueryKey(serverId), [serverId]);
  const enabled = Boolean(serverId && client && isConnected && supported);

  const query = useFetchQuery({
    dataShape: "value",
    queryKey,
    queryFn: async () => {
      if (!client) throw new Error("Not connected");
      return client.checkProviderUpdates();
    },
    enabled,
    staleTimeMs: PROVIDER_UPDATES_STALE_TIME_MS,
  });

  const refresh = useCallback(async () => {
    if (!client || !enabled) return;
    setActionError(null);
    const payload = await client.checkProviderUpdates({ forceRefresh: true });
    queryClient.setQueryData(queryKey, payload);
  }, [client, enabled, queryClient, queryKey]);

  const installMutation = useMutation({
    mutationFn: async (provider: string) => {
      if (!client) throw new Error("Not connected");
      return client.installProviderUpdate({ provider, timeout: INSTALL_TIMEOUT_MS });
    },
  });

  const install = useCallback(
    async (provider: string) => {
      if (!client || !enabled) return;
      setActionError(null);
      setInstallingProvider(provider);
      try {
        const result = await installMutation.mutateAsync(provider);
        if (result.error) {
          setActionError(result.error);
        }
        // Whether it succeeded or failed, the cached versions are now suspect.
        await refresh();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      } finally {
        setInstallingProvider(null);
      }
    },
    [client, enabled, installMutation, refresh],
  );

  const setPreferences = useCallback(
    async (patch: Partial<ProviderUpdatePreferences>) => {
      if (!client || !enabled) return;
      setActionError(null);
      try {
        const payload = await client.setProviderUpdatePreferences(patch);
        queryClient.setQueryData(queryKey, payload);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : String(error));
      }
    },
    [client, enabled, queryClient, queryKey],
  );

  let queryError: string | null = null;
  if (query.isError) {
    queryError = query.error instanceof Error ? query.error.message : String(query.error);
  }

  return {
    entries: query.data?.entries ?? [],
    preferences: query.data?.preferences ?? null,
    checkedAt: query.data?.checkedAt ?? null,
    isLoading: query.isLoading,
    isRefreshing: query.isFetching,
    error: actionError ?? queryError ?? query.data?.error ?? null,
    installingProvider,
    supported,
    refresh,
    install,
    setPreferences,
  };
}
