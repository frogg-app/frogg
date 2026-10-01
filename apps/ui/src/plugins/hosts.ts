import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useShallow } from "zustand/shallow";
import { brand } from "@frogg/branding";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/** The build's own brand policy; a brand that disables plugins hides every plugin surface. */
export function isPluginsEnabledByBrand(): boolean {
  return brand.plugins.enabled;
}

export function isPluginDeveloperModeAllowedByBrand(): boolean {
  return brand.plugins.developerMode !== "forbidden";
}

/**
 * Hosts that are online and advertise `server_info.features.plugins`. This is the single
 * capability gate for the plugin UI: everything downstream takes a server id from this list.
 */
export function usePluginHostIds(): string[] {
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const onlineKey = useOnlineServerIdsKey(serverIds);
  const featureIds = useSessionStore(
    useShallow((state) =>
      serverIds.filter((id) => state.sessions[id]?.serverInfo?.features?.plugins === true),
    ),
  );
  return useMemo(() => {
    const online = new Set(onlineKey.split("\n"));
    return featureIds.filter((id) => online.has(id));
  }, [featureIds, onlineKey]);
}

export function useHostLabel(serverId: string | null): string {
  const hosts = useHosts();
  if (!serverId) return "";
  const host = hosts.find((entry) => entry.serverId === serverId);
  return host?.label?.trim() || serverId;
}

/** Online server ids joined into one string, so the hook re-renders only when the set changes. */
function useOnlineServerIdsKey(serverIds: readonly string[]): string {
  const store = getHostRuntimeStore();
  const subscribe = useCallback(
    (onChange: () => void) => {
      const offs = serverIds.map((id) => store.subscribe(id, onChange));
      return () => {
        for (const off of offs) off();
      };
    },
    [serverIds, store],
  );
  const read = useCallback(
    () => serverIds.filter((id) => isHostRuntimeConnected(store.getSnapshot(id))).join("\n"),
    [serverIds, store],
  );
  return useSyncExternalStore(subscribe, read, read);
}
