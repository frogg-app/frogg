import { useTranslation } from "react-i18next";
import { useHosts } from "@/runtime/host-runtime";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

/**
 * The name the inset switcher shows: the one host the app is scoped to (by the host filter, or
 * because it is the only host), else "All hosts".
 */
export function useScopedHostLabel(): string {
  const { t } = useTranslation();
  const hosts = useHosts();
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const scoped =
    hostFilters.length === 1
      ? hosts.find((host) => host.serverId === hostFilters[0])
      : hosts.length === 1
        ? hosts[0]
        : undefined;
  return scoped ? scoped.label?.trim() || scoped.serverId : t("sidebar.display.hostFilter.all");
}
