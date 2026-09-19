import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { providerUsageCopy } from "./copy";
import type { ProviderUsageView } from "./types";

export const PROVIDER_USAGE_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * COMPAT(providerUsageAccountScoped): the account scope is part of the key. Two
 * sign-ins of the same provider report different numbers, so they must never
 * share a cache entry.
 */
export function providerUsageQueryKey(
  serverId: string | null | undefined,
  scope?: { provider?: string; providerAccountId?: string | null },
) {
  return [
    "providerUsage",
    serverId ?? "",
    scope?.provider ?? "",
    // `null` (the Default pick) and an absent pick resolve to different config
    // directories daemon-side, so they get different keys.
    scope && "providerAccountId" in scope && scope.providerAccountId !== undefined
      ? scope.providerAccountId
      : "",
  ] as const;
}

interface UseProviderUsageOptions {
  enabled?: boolean;
  /**
   * COMPAT(providerUsageAccountScoped): scope this provider's figures to one
   * sign-in. Both are needed: a `providerAccountId` with no `provider` names
   * nothing the daemon can resolve.
   */
  provider?: string;
  providerAccountId?: string | null;
}

export function useProviderUsage(
  serverId: string | null | undefined,
  options: UseProviderUsageOptions = {},
): {
  view: ProviderUsageView;
  refresh: () => Promise<void>;
  canFetch: boolean;
} {
  const queryClient = useQueryClient();
  const client = useHostRuntimeClient(serverId ?? "");
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const supportsProviderUsage = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.providerUsageList === true,
  );
  const accountScoped = useSessionStore(
    (state) =>
      state.sessions[serverId ?? ""]?.serverInfo?.features?.providerUsageAccountScoped === true,
  );
  // An older daemon ignores the scope and answers for its default config
  // directory, so asking it for one is pointless — and keying the cache as if
  // it had honoured the scope would file the default answer under an account.
  // `providerAccountId: undefined` is safe to pass along: the client and the
  // query key both drop it, which is what "the active account" means.
  const { provider: scopeProvider, providerAccountId: scopeAccountId } = options;
  const scope = useMemo(
    () =>
      accountScoped && scopeProvider
        ? { provider: scopeProvider, providerAccountId: scopeAccountId }
        : undefined,
    [accountScoped, scopeAccountId, scopeProvider],
  );
  const queryKey = useMemo(() => providerUsageQueryKey(serverId, scope), [scope, serverId]);
  const canFetch = Boolean(serverId && client && isConnected && supportsProviderUsage);
  const enabled = Boolean((options.enabled ?? true) && canFetch);

  const queryFn = useCallback(async () => {
    if (!client) {
      throw new Error(providerUsageCopy.clientUnavailable);
    }
    return client.listProviderUsage(scope);
  }, [client, scope]);

  const query = useQuery({
    queryKey,
    queryFn,
    enabled,
    staleTime: PROVIDER_USAGE_STALE_TIME_MS,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const refresh = useCallback(async () => {
    if (!canFetch) return;
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.fetchQuery({
      queryKey,
      queryFn,
      staleTime: PROVIDER_USAGE_STALE_TIME_MS,
    });
  }, [canFetch, queryClient, queryFn, queryKey]);

  const view = useMemo<ProviderUsageView>(() => {
    if (!serverId || !client || !isConnected) {
      return { kind: "error", message: providerUsageCopy.hostUnavailable };
    }
    if (!supportsProviderUsage) {
      return { kind: "error", message: providerUsageCopy.hostUpgradeRequired };
    }
    if (query.data) {
      return {
        kind: "ready",
        payload: query.data,
        isRefreshing: query.isFetching,
      };
    }
    if (query.isError) {
      return {
        kind: "error",
        message: query.error instanceof Error ? query.error.message : String(query.error),
      };
    }
    return { kind: "loading" };
  }, [
    client,
    isConnected,
    query.data,
    query.error,
    query.isError,
    query.isFetching,
    serverId,
    supportsProviderUsage,
  ]);

  return { view, refresh, canFetch };
}
