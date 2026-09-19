import { Text, View } from "react-native";
import { Workflow } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { CiPane } from "./ci-pane";

const ThemedWorkflow = withUnistyles(Workflow);
const ciRunsPanelPresentation = {
  label: (t) => t("ciMonitor.label"),
  subtitle: (t) => t("ciMonitor.subtitle"),
  tooltip: (t) => t("ciMonitor.subtitle"),
  icon: ThemedWorkflow,
} satisfies PanelPresentation;

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

/** The CI tab of the right-hand pane, beside Files and Changes. */
function CiRunsPanel() {
  const { t } = useTranslation();
  const { serverId, workspaceId, target } = usePaneContext();
  invariant(target.kind === "ci_runs", "CiRunsPanel requires ci_runs target");
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  if (!cwd) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }
  return <CiPane serverId={serverId} cwd={cwd} />;
}

export const ciRunsPanelRegistration = definePanel("ci_runs", {
  component: CiRunsPanel,
  presentation: ciRunsPanelPresentation,
});
