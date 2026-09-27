import { useCallback, useEffect, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { BrowseTab } from "./browse-tab";
import { ConsentView } from "./consent-view";
import { DeveloperView } from "./developer-view";
import { usePluginHostIds } from "./hosts";
import { InstalledTab } from "./installed-tab";
import { usePluginsModalStore, type PluginsTab, type PluginsTarget } from "./modal-store";
import { usePluginsList } from "./queries";
import { PluginSettingsView } from "./plugin-settings-view";
import { RepositoriesTab } from "./repositories-tab";
import { TargetSelect } from "./target-select";
import { ClientTargetBody } from "./client-target";

/**
 * The plugins manager: pick a target (this client or a host), then Installed / Browse /
 * Repositories. Second-level views (consent, a plugin's settings, developer mode) replace the
 * tabs and return with the header back arrow.
 */
export function PluginsModalHost(): ReactElement | null {
  const visible = usePluginsModalStore((state) => state.visible);
  if (!visible) return null;
  return <PluginsModal />;
}

function useResolvedTarget(): PluginsTarget {
  const target = usePluginsModalStore((state) => state.target);
  const setTarget = usePluginsModalStore((state) => state.setTarget);
  const hostIds = usePluginHostIds();
  const firstHost = hostIds[0] ?? null;
  const stale = target?.kind === "host" && !hostIds.includes(target.serverId);
  useEffect(() => {
    // Default to the first capable host; fall back when the chosen host drops off.
    if ((target === null || stale) && firstHost) {
      setTarget({ kind: "host", serverId: firstHost });
    }
  }, [firstHost, setTarget, stale, target]);
  if (target && !stale) return target;
  return firstHost ? { kind: "host", serverId: firstHost } : { kind: "client" };
}

function PluginsModal(): ReactElement {
  const { t } = useTranslation();
  const close = usePluginsModalStore((state) => state.close);
  const view = usePluginsModalStore((state) => state.view);
  const setView = usePluginsModalStore((state) => state.setView);
  const tab = usePluginsModalStore((state) => state.tab);
  const setTab = usePluginsModalStore((state) => state.setTab);
  const target = useResolvedTarget();
  const serverId = target.kind === "host" ? target.serverId : null;
  const list = usePluginsList(serverId);
  const allowUserRepos = list.data?.policy.allowUserRepos === true;
  const effectiveTab: PluginsTab = tab === "repositories" && !allowUserRepos ? "installed" : tab;

  const backToTabs = useCallback(() => setView({ kind: "tabs" }), [setView]);
  const header = useMemo<SheetHeader>(() => {
    switch (view.kind) {
      case "settings":
        return {
          title: t("plugins.settings.title", { name: view.pluginName }),
          back: { onPress: backToTabs },
        };
      case "developer":
        return { title: t("plugins.developer.title"), back: { onPress: backToTabs } };
      case "consent":
        return {
          title:
            view.mode === "install"
              ? t("plugins.consent.installTitle", { name: view.entry.name })
              : t("plugins.consent.updateTitle", { name: view.plugin.name }),
          back: { onPress: backToTabs },
        };
      default:
        return { title: t("plugins.title") };
    }
  }, [backToTabs, t, view]);

  const tabOptions = useMemo<SegmentedControlOption<PluginsTab>[]>(() => {
    const options: SegmentedControlOption<PluginsTab>[] = [
      { value: "installed", label: t("plugins.tabs.installed"), testID: "plugins-tab-installed" },
      { value: "browse", label: t("plugins.tabs.browse"), testID: "plugins-tab-browse" },
    ];
    if (allowUserRepos) {
      options.push({
        value: "repositories",
        label: t("plugins.tabs.repositories"),
        testID: "plugins-tab-repositories",
      });
    }
    return options;
  }, [allowUserRepos, t]);

  return (
    <AdaptiveModalSheet
      visible
      onClose={close}
      header={header}
      desktopMaxWidth={640}
      sizeContentToCurrentSnapPoint
      testID="plugins-modal"
    >
      {view.kind === "tabs" ? (
        <View style={styles.body}>
          <TargetSelect target={target} />
          {serverId ? (
            <>
              <SegmentedControl
                options={tabOptions}
                value={effectiveTab}
                onValueChange={setTab}
                size="sm"
                testID="plugins-tabs"
              />
              <PluginsTabBody serverId={serverId} tab={effectiveTab} />
            </>
          ) : (
            <ClientTargetBody tab={effectiveTab} onTabChange={setTab} />
          )}
        </View>
      ) : null}
      {view.kind === "settings" && serverId ? (
        <PluginSettingsView serverId={serverId} pluginId={view.pluginId} />
      ) : null}
      {view.kind === "developer" && serverId ? <DeveloperView serverId={serverId} /> : null}
      {view.kind === "consent" && serverId ? <ConsentView serverId={serverId} view={view} /> : null}
    </AdaptiveModalSheet>
  );
}

function PluginsTabBody({ serverId, tab }: { serverId: string; tab: PluginsTab }) {
  if (tab === "browse") return <BrowseTab serverId={serverId} />;
  if (tab === "repositories") return <RepositoriesTab serverId={serverId} />;
  return <InstalledTab serverId={serverId} />;
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
  },
}));
