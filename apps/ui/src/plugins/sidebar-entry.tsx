import { isClientPluginRuntimeSupported } from "./client-runtime/storage";
import { useCallback, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Puzzle } from "lucide-react-native";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
import { useFetchQueries } from "@/data/query";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { i18n } from "@/i18n/i18next";
import { isPluginsEnabledByBrand, usePluginHostIds } from "./hosts";
import { openPluginsModal } from "./modal-store";
import { pluginsQueryKeys } from "./query-keys";

/**
 * True while plugins are usable: the brand allows them and either this device runs client
 * plugins (desktop, web) or a connected host advertises the feature with plugins not disabled.
 */
export function usePluginsEntryVisible(): boolean {
  const serverIds = usePluginHostIds();
  const results = useFetchQueries(
    serverIds.map((serverId) => ({
      queryKey: pluginsQueryKeys.list(serverId) as readonly unknown[],
      queryFn: () => {
        const client = getHostRuntimeStore().getClient(serverId);
        if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
        return client.pluginsList();
      },
      dataShape: "value" as const,
      staleTimeMs: 30_000,
      retry: false,
    })),
  );
  if (!isPluginsEnabledByBrand()) return false;
  // Desktop and web can always manage this device's own client plugins.
  if (isClientPluginRuntimeSupported()) return true;
  // Unknown (loading/failed) counts as usable so the entry doesn't flicker in and out.
  return results.some((result) => result.data?.policy.enabled !== false);
}

/** Sidebar footer row, between Add project and Hosts. */
export function PluginsSidebarEntry({
  onBeforeAction,
}: {
  onBeforeAction?: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const visible = usePluginsEntryVisible();
  const open = useCallback(() => {
    onBeforeAction?.();
    openPluginsModal();
  }, [onBeforeAction]);
  if (!visible) return null;
  return (
    <SidebarHeaderRow
      icon={Puzzle}
      onPress={open}
      label={t("plugins.title")}
      testID="sidebar-plugins"
      nativeID="sidebar-plugins"
      variant="compact"
    />
  );
}
