import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  ProviderAccountExportResponseMessage,
  ProviderAccountListResponseMessage,
} from "@frogg/protocol/messages";
import type {
  ProviderAccountExportBundle,
  ProviderAccountPreferences,
} from "@frogg/protocol/provider-accounts";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

export type ProviderAccountsPayload = ProviderAccountListResponseMessage["payload"];
export type ProviderAccountExportPayload = ProviderAccountExportResponseMessage["payload"];

export function providerAccountsQueryKey(serverId: string) {
  return ["host", serverId, "provider-accounts"] as const;
}

/**
 * One query for the whole screen. Every provider-account response carries the
 * full account list, the capability manifest and the active account per
 * provider, so each mutation's payload replaces the cache outright instead of
 * triggering a refetch.
 */
export function useProviderAccounts(serverId: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId);
  const connected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "providerAccounts");
  const queryKey = useMemo(() => providerAccountsQueryKey(serverId), [serverId]);

  const query = useFetchQuery<ProviderAccountsPayload, Error>({
    queryKey,
    queryFn: () => {
      if (!client) throw new Error(t("settings.host.providerAccounts.unavailable"));
      return client.listProviderAccounts();
    },
    enabled: supported && connected && client !== null,
    retry: false,
    dataShape: "value",
    staleTimeMs: 0,
  });

  const applyPayload = useCallback(
    (payload: ProviderAccountsPayload) => {
      queryClient.setQueryData(queryKey, payload);
      return payload;
    },
    [queryClient, queryKey],
  );

  const requireClient = useCallback(() => {
    if (!client) throw new Error(t("settings.host.providerAccounts.unavailable"));
    return client;
  }, [client, t]);

  // The daemon reports refusals in `payload.error` rather than as a transport
  // failure, and still returns the current list beside it. The mutations
  // therefore resolve with the payload; callers decide how to show `error` and
  // `warnings`. A rejected promise here means the request never landed.
  const create = useMutation({
    mutationFn: async (input: { provider: string; name: string; linkedFolders: string[] }) =>
      requireClient().createProviderAccount({
        provider: input.provider,
        name: input.name,
        linkedFolders: input.linkedFolders,
      }),
    onSuccess: applyPayload,
  });

  const remove = useMutation({
    mutationFn: async (accountId: string) => requireClient().deleteProviderAccount({ accountId }),
    onSuccess: applyPayload,
  });

  const setActive = useMutation({
    mutationFn: async (input: { provider: string; accountId: string | null }) =>
      requireClient().setActiveProviderAccount({
        provider: input.provider,
        accountId: input.accountId,
      }),
    onSuccess: applyPayload,
  });

  const rename = useMutation({
    mutationFn: async (input: { accountId: string; name: string }) =>
      requireClient().renameProviderAccount({
        accountId: input.accountId,
        name: input.name,
      }),
    onSuccess: applyPayload,
  });

  const signOut = useMutation({
    mutationFn: async (accountId: string) => requireClient().signOutProviderAccount({ accountId }),
    onSuccess: applyPayload,
  });

  const setAllowedModels = useMutation({
    mutationFn: async (input: { accountId: string; allowedModels: string[] | null }) =>
      requireClient().setProviderAccountAllowedModels({
        accountId: input.accountId,
        allowedModels: input.allowedModels,
      }),
    onSuccess: applyPayload,
  });

  const setPreferences = useMutation({
    mutationFn: async (input: {
      accountId: string;
      preferences: ProviderAccountPreferences | null;
    }) =>
      requireClient().setProviderAccountPreferences({
        accountId: input.accountId,
        preferences: input.preferences,
      }),
    onSuccess: applyPayload,
  });

  // Export resolves with the bundle rather than a snapshot, so it never touches
  // the cache. The bundle is secret material: it is handed straight back to the
  // caller and is never logged or persisted here.
  const exportAccounts = useMutation({
    mutationFn: async (input: { provider: string; accountIds?: string[] }) =>
      requireClient().exportProviderAccounts({
        provider: input.provider,
        ...(input.accountIds ? { accountIds: input.accountIds } : {}),
      }),
  });

  const importAccounts = useMutation({
    mutationFn: async (bundle: ProviderAccountExportBundle) =>
      requireClient().importProviderAccounts({ bundle }),
    onSuccess: applyPayload,
  });

  const refetch = query.refetch;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return {
    connected,
    supported,
    payload: query.data ?? null,
    isLoading: query.isPending,
    loadError: query.isError ? query.error : null,
    refresh,
    create,
    remove,
    setActive,
    rename,
    signOut,
    setAllowedModels,
    setPreferences,
    exportAccounts,
    importAccounts,
  };
}
