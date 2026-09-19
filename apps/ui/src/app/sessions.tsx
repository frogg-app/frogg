import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { SessionsScreen } from "@/screens/sessions-screen";

/** Expo repeats a param that appears twice in a URL, so take the first. */
function firstParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * `/sessions` is the app-wide history. Given `projectKey` and `serverId` it is
 * the same list scoped to one project on one host — the destination of a
 * project's "Show archived sessions" action.
 */
export default function SessionsRoute() {
  const params = useLocalSearchParams<{ projectKey?: string; serverId?: string }>();
  const projectKey = firstParam(params.projectKey);
  const serverId = firstParam(params.serverId);

  return (
    <HostRouteBootstrapBoundary>
      <SessionsScreen projectKey={projectKey} serverId={serverId} />
    </HostRouteBootstrapBoundary>
  );
}
