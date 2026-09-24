import { Redirect, useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { buildHostRootRoute, buildSettingsRoute } from "@/utils/host-routes";

// COMPAT(pluginsRemoved): plugin surfaces were removed; send old deep links to
// the host instead of the unknown-route screen. Remove after 2027-09-13.
export default function LegacyPluginSurfaceRoute() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId.trim() : "";
  const href = serverId.length > 0 ? buildHostRootRoute(serverId) : buildSettingsRoute();

  return (
    <HostRouteBootstrapBoundary>
      <Redirect href={href} />
    </HostRouteBootstrapBoundary>
  );
}
