import { Text, View } from "react-native";
import { Waypoints } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { StreamsPane } from "./streams-pane";

const ThemedWaypoints = withUnistyles(Waypoints);
const releaseStreamsPanelPresentation = {
  label: (t) => t("releaseStreams.label"),
  subtitle: (t) => t("releaseStreams.subtitle"),
  tooltip: (t) => t("releaseStreams.subtitle"),
  icon: ThemedWaypoints,
} satisfies PanelPresentation;

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

/** Release streams as a workspace tab: wide enough for the graph beside an agent. */
function ReleaseStreamsPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "release_streams", "ReleaseStreamsPanel requires release_streams target");
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  if (!cwd) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }
  return <StreamsPane serverId={serverId} cwd={cwd} />;
}

export const releaseStreamsPanelRegistration = definePanel("release_streams", {
  component: ReleaseStreamsPanel,
  presentation: releaseStreamsPanelPresentation,
});
