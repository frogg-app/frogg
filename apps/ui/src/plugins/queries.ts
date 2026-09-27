import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/i18n/i18next";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useClientContributionSets } from "./client-runtime/contributions";
import { pluginsQueryKeys } from "./query-keys";

const LIST_STALE_MS = 30_000;
const CATALOG_STALE_MS = 5 * 60_000;

function requireClient(client: DaemonClient | null): DaemonClient {
  if (!client) {
    throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
  }
  return client;
}

/** Installed plugins and the host's plugin policy. Refetched on `plugins.changed`. */
export function usePluginsList(serverId: string | null) {
  const client = useHostRuntimeClient(serverId ?? "");
  return useFetchQuery({
    queryKey: pluginsQueryKeys.list(serverId ?? ""),
    queryFn: () => requireClient(client).pluginsList(),
    enabled: Boolean(serverId && client),
    dataShape: "value",
    staleTimeMs: LIST_STALE_MS,
    retry: false,
  });
}

export function usePluginsCatalog(serverId: string | null, enabled: boolean) {
  const client = useHostRuntimeClient(serverId ?? "");
  return useFetchQuery({
    queryKey: pluginsQueryKeys.catalog(serverId ?? ""),
    queryFn: () => requireClient(client).pluginsGetCatalog(),
    enabled: Boolean(serverId && client && enabled),
    dataShape: "value",
    staleTimeMs: CATALOG_STALE_MS,
    retry: false,
  });
}

export function usePluginRepos(serverId: string | null, enabled: boolean) {
  const client = useHostRuntimeClient(serverId ?? "");
  return useFetchQuery({
    queryKey: pluginsQueryKeys.repos(serverId ?? ""),
    queryFn: () => requireClient(client).pluginsReposList(),
    enabled: Boolean(serverId && client && enabled),
    dataShape: "value",
    staleTimeMs: LIST_STALE_MS,
    retry: false,
  });
}

export function usePluginContributions(serverId: string) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: pluginsQueryKeys.contributions(serverId),
    queryFn: () => requireClient(client).pluginsGetContributions(),
    enabled: Boolean(serverId && client?.supportsPlugins()),
    dataShape: "value",
    staleTimeMs: LIST_STALE_MS,
    retry: false,
  });
}

/**
 * Host contributions plus this device's client-scope plugins, for the surfaces that render them
 * (session actions, panels). Host sets win on an id clash.
 */
export function useMergedPluginContributions(serverId: string) {
  const host = usePluginContributions(serverId);
  const local = useClientContributionSets();
  const contributions = useMemo(() => {
    const hostSets = host.data?.contributions ?? [];
    const hostIds = new Set(hostSets.map((set) => set.pluginId));
    return [...hostSets, ...local.filter((set) => !hostIds.has(set.pluginId))];
  }, [host.data, local]);
  return { contributions, isPending: host.isPending && local.length === 0 };
}

export function usePluginSettings(serverId: string, pluginId: string) {
  const client = useHostRuntimeClient(serverId);
  return useFetchQuery({
    queryKey: pluginsQueryKeys.settings(serverId, pluginId),
    queryFn: () => requireClient(client).pluginsSettingsGet(pluginId),
    enabled: Boolean(client),
    dataShape: "value",
    staleTimeMs: LIST_STALE_MS,
    retry: false,
  });
}

/**
 * A mutation against one host's plugin state. Every plugin mutation invalidates the host's
 * plugin queries on success; `plugins.changed` does the same for changes made elsewhere.
 */
export function usePluginMutation<TInput, TResult>(
  serverId: string | null,
  run: (client: DaemonClient, input: TInput) => Promise<TResult>,
) {
  const client = useHostRuntimeClient(serverId ?? "");
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => run(requireClient(client), input),
    onSuccess: () => {
      if (serverId) {
        void queryClient.invalidateQueries({ queryKey: pluginsQueryKeys.host(serverId) });
      }
    },
  });
}
