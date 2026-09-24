import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppActivelyVisible } from "@/hooks/use-app-visible";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { providerUsageCopy } from "./copy";
import { useUsageMeterPreferences } from "./use-meter-preferences";
import type { ProviderUsageView } from "./types";

export const PROVIDER_USAGE_STALE_TIME_MS = 5 * 60 * 1000;

/**
 * Hosts whose next usage reads must skip the daemon's cache, until the stamped
 * time. A host-wide refresh invalidates queries that each refetch with their own
 * query function, so the request for fresh figures has to travel out of band.
 */
const FORCE_FRESH_WINDOW_MS = 2000;
const forceFreshUntil = new Map<string, number>();

function wantsFreshUsage(serverId: string | null | undefined): boolean {
  return (forceFreshUntil.get(serverId ?? "") ?? 0) > Date.now();
}

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
   * Run the user's refresh timer for this consumer. Only the meters that stay
   * on screen ask for it: a tooltip's own query refreshes when it opens, and
   * two consumers polling one cache entry would double the request rate.
   */
  autoRefresh?: boolean;
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
  const preferences = useUsageMeterPreferences();
  const isAppFocused = useAppActivelyVisible();
  // Polling a provider API for a window nobody is looking at spends someone
  // else's rate limit, so the timer only runs while the app has focus.
  const refetchInterval =
    options.autoRefresh === true &&
    preferences.refreshWhileFocused &&
    preferences.refreshIntervalSeconds > 0 &&
    isAppFocused
      ? preferences.refreshIntervalSeconds * 1000
      : (false as const);
  const canFetch = Boolean(serverId && client && isConnected && supportsProviderUsage);
  const enabled = Boolean((options.enabled ?? true) && canFetch);

  // The daemon caches usage for minutes, so each read says how old an answer it
  // will take: the timer's own interval while polling, and "fresh" for a
  // deliberate refresh (hover, agent response, the refresh button).
  const timerMaxAgeMs = refetchInterval === false ? undefined : refetchInterval;
  const fetchUsage = useCallback(
    async (maxAgeMs: number | undefined) => {
      if (!client) {
        throw new Error(providerUsageCopy.clientUnavailable);
      }
      return client.listProviderUsage({
        ...scope,
        ...(maxAgeMs === undefined ? {} : { maxAgeMs }),
      });
    },
    [client, scope],
  );
  const queryFn = useCallback(
    () => fetchUsage(wantsFreshUsage(serverId) ? 0 : timerMaxAgeMs),
    [fetchUsage, serverId, timerMaxAgeMs],
  );
  const freshQueryFn = useCallback(() => fetchUsage(0), [fetchUsage]);

  const query = useQuery({
    queryKey,
    queryFn,
    enabled,
    // The timer is the freshness contract while it runs, so it must not be
    // held off by the long idle stale time the tooltips rely on.
    staleTime: refetchInterval === false ? PROVIDER_USAGE_STALE_TIME_MS : 0,
    refetchInterval,
    refetchIntervalInBackground: false,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const refresh = useCallback(async () => {
    if (!canFetch) return;
    // A timer read already in flight would be joined rather than replaced, and it
    // may be served from the daemon's cache.
    await queryClient.cancelQueries({ queryKey });
    await queryClient.fetchQuery({
      queryKey,
      queryFn: freshQueryFn,
      staleTime: 0,
    });
  }, [canFetch, freshQueryFn, queryClient, queryKey]);

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

/**
 * Refreshes every provider-usage query for one host, whichever account each was
 * read for. The page's Refresh button has to reach the account-scoped queries
 * the cards make for themselves, not just the unscoped list it holds itself.
 */
export function useRefreshHostProviderUsage(serverId: string | null | undefined): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    forceFreshUntil.set(serverId ?? "", Date.now() + FORCE_FRESH_WINDOW_MS);
    void queryClient.invalidateQueries({
      queryKey: ["providerUsage", serverId ?? ""],
      exact: false,
    });
  }, [queryClient, serverId]);
}
