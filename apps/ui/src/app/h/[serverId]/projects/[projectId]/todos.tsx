import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { ProjectTodosScreen } from "@/project-todos/project-todos-screen";
import { normalizeProjectSettingsRouteId } from "@/utils/host-routes";

export default function HostProjectTodosRoute() {
  const params = useLocalSearchParams<{
    serverId?: string | string[];
    projectId?: string | string[];
  }>();
  const serverId = normalizeProjectSettingsRouteId(params.serverId);
  const projectId = normalizeProjectSettingsRouteId(params.projectId);
  return (
    <HostRouteBootstrapBoundary>
      <ProjectTodosScreen serverId={serverId} projectId={projectId} />
    </HostRouteBootstrapBoundary>
  );
}
