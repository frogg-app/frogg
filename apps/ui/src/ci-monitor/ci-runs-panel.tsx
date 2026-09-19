import { Workflow } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { CiPane } from "./ci-pane";

const ThemedWorkflow = withUnistyles(Workflow);
const ciRunsPanelPresentation = {
  label: (t) => t("ciMonitor.label"),
  subtitle: (t) => t("ciMonitor.subtitle"),
  tooltip: (t) => t("ciMonitor.subtitle"),
  icon: ThemedWorkflow,
} satisfies PanelPresentation;

/** DESIGN PROTOTYPE. The CI tab of the right-hand pane, beside Files and Changes. */
function CiRunsPanel() {
  const { workspaceId, target } = usePaneContext();
  invariant(target.kind === "ci_runs", "CiRunsPanel requires ci_runs target");
  return <CiPane workspaceId={workspaceId} />;
}

export const ciRunsPanelRegistration = definePanel("ci_runs", {
  component: CiRunsPanel,
  presentation: ciRunsPanelPresentation,
});
