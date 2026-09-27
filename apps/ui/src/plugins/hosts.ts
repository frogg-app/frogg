import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { brand } from "@frogg/branding";
import { useHostRuntimeConnectionStatuses, useHosts } from "@/runtime/host-runtime";
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
  const statuses = useHostRuntimeConnectionStatuses(serverIds);
  const featureIds = useSessionStore(
    useShallow((state) =>
      serverIds.filter((id) => state.sessions[id]?.serverInfo?.features?.plugins === true),
    ),
  );
  return useMemo(
    () => featureIds.filter((id) => statuses.get(id) === "online"),
    [featureIds, statuses],
  );
}

export function useHostLabel(serverId: string | null): string {
  const hosts = useHosts();
  if (!serverId) return "";
  const host = hosts.find((entry) => entry.serverId === serverId);
  return host?.label?.trim() || serverId;
}
