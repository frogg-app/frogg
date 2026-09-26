import { useLocalSearchParams } from "expo-router";
import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { NewChatScreen } from "@/screens/new-chat-screen";

export default function NewChatRoute() {
  const params = useLocalSearchParams<{ serverId?: string }>();
  const serverId = typeof params.serverId === "string" ? params.serverId : "";
  return (
    <HostRouteBootstrapBoundary>
      <NewChatScreen key={serverId} serverId={serverId} />
    </HostRouteBootstrapBoundary>
  );
}
