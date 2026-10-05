import { useMemo, type ReactElement } from "react";
import { Puzzle } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor } from "@/panels/panel-registry";
import { PluginPanelBody } from "./panel-content";
import { useMergedPluginContributions } from "./queries";
import { PluginViewFrame } from "./view-frame";

const ThemedPuzzle = withUnistyles(Puzzle);

function usePluginPanelDescriptor(
  target: { kind: "plugin_panel"; pluginId: string; panelId: string },
  context: { serverId: string },
): PanelDescriptor {
  const { t } = useTranslation();
  const contributions = useMergedPluginContributions(context.serverId);
  return useMemo(() => {
    const set = contributions.contributions.find((c) => c.pluginId === target.pluginId);
    const panel =
      set?.panels.find((p) => p.id === target.panelId) ??
      set?.views?.find((v) => v.id === target.panelId);
    const label = panel?.title ?? target.panelId;
    const subtitle = set?.pluginName ?? target.pluginId;
    return {
      label,
      subtitle,
      tooltip: t("plugins.panel.tooltip", { panel: label, plugin: subtitle }),
      titleState: contributions.isPending ? "loading" : "ready",
      icon: ThemedPuzzle,
      statusBucket: null,
    };
  }, [contributions.contributions, contributions.isPending, t, target.panelId, target.pluginId]);
}

/** Declarative panels and custom views share the `plugin_panel` tab target. */
function PluginPanel(): ReactElement {
  const { serverId, target, closeCurrentTab } = usePaneContext();
  invariant(target.kind === "plugin_panel", "PluginPanel requires plugin_panel target");
  const contributions = useMergedPluginContributions(serverId);
  const set = contributions.contributions.find((c) => c.pluginId === target.pluginId);
  if (set?.views?.some((v) => v.id === target.panelId)) {
    return (
      <PluginViewFrame
        pluginId={target.pluginId}
        pluginName={set.pluginName}
        viewId={target.panelId}
        onClose={closeCurrentTab}
      />
    );
  }
  return (
    <PluginPanelBody serverId={serverId} pluginId={target.pluginId} panelId={target.panelId} />
  );
}

export const pluginPanelRegistration = definePanel("plugin_panel", {
  component: PluginPanel,
  useDescriptor: usePluginPanelDescriptor,
});
