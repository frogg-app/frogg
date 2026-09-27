import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type {
  DaemonClient,
  PluginInstalled,
  PluginPolicy,
} from "@frogg/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { PluginSpinner } from "./spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { confirmDialog } from "@/utils/confirm-dialog";
import { PluginStatusBadge, PluginTierBadge } from "./badges";
import { describePluginError, isPluginErrorCode } from "./errors";
import { usePluginsModalStore } from "./modal-store";
import { usePluginContributions, usePluginMutation, usePluginsList } from "./queries";
import { PluginRequestError } from "@frogg/client/internal/daemon-client";
import { pluginStyles as styles } from "./shared-styles";

export function InstalledTab({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const list = usePluginsList(serverId);
  const contributions = usePluginContributions(serverId);
  const setView = usePluginsModalStore((state) => state.setView);
  const openDeveloper = useCallback(() => setView({ kind: "developer" }), [setView]);

  const settingsIds = useMemo(
    () =>
      new Set(
        (contributions.data?.contributions ?? [])
          .filter((set) => set.settings.length > 0)
          .map((set) => set.pluginId),
      ),
    [contributions.data],
  );

  if (list.isPending) {
    return <PluginSpinner />;
  }
  if (list.isError) {
    return (
      <Text style={styles.error} testID="plugins-installed-error">
        {isPluginErrorCode(list.error, "forbidden")
          ? t("plugins.disabledByBrand")
          : describePluginError(list.error)}
      </Text>
    );
  }
  const { plugins, policy } = list.data;
  if (!policy.enabled) {
    return <Text style={styles.empty}>{t("plugins.disabledByBrand")}</Text>;
  }

  return (
    <View style={styles.list} testID="plugins-installed">
      <DeveloperToolbar policy={policy} onOpen={openDeveloper} />
      {plugins.length === 0 ? (
        <Text style={styles.empty} testID="plugins-installed-empty">
          {t("plugins.installed.empty")}
        </Text>
      ) : null}
      {plugins.map((plugin) => (
        <InstalledRow
          key={plugin.id}
          serverId={serverId}
          plugin={plugin}
          hasSettings={settingsIds.has(plugin.id)}
        />
      ))}
    </View>
  );
}

function DeveloperToolbar({ policy, onOpen }: { policy: PluginPolicy; onOpen: () => void }) {
  const { t } = useTranslation();
  if (policy.developerMode === "forbidden") return null;
  return (
    <View style={styles.toolbar}>
      <Text style={styles.meta}>
        {policy.developerModeEnabled ? t("plugins.developer.on") : t("plugins.developer.off")}
      </Text>
      <Button variant="ghost" size="sm" onPress={onOpen} testID="plugins-developer-open">
        {t("plugins.developer.title")}
      </Button>
    </View>
  );
}

const setEnabled = (client: DaemonClient, input: { id: string; enabled: boolean }) =>
  client.pluginsSetEnabled(input.id, input.enabled);
const update = (client: DaemonClient, id: string) => client.pluginsUpdate({ id });
const uninstall = (client: DaemonClient, id: string) => client.pluginsUninstall(id);
const unlink = (client: DaemonClient, id: string) => client.pluginsDevUnlink(id);

function InstalledRow({
  serverId,
  plugin,
  hasSettings,
}: {
  serverId: string;
  plugin: PluginInstalled;
  hasSettings: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const setView = usePluginsModalStore((state) => state.setView);
  const toggle = usePluginMutation(serverId, setEnabled);
  const updater = usePluginMutation(serverId, update);
  const remover = usePluginMutation(serverId, uninstall);
  const unlinker = usePluginMutation(serverId, unlink);
  const isDev = plugin.source === "dev";
  const busy = toggle.isPending || updater.isPending || remover.isPending || unlinker.isPending;
  const failure = toggle.error ?? updater.error ?? remover.error ?? unlinker.error;

  const handleToggle = useCallback(
    (enabled: boolean) => toggle.mutate({ id: plugin.id, enabled }),
    [plugin.id, toggle],
  );
  const handleUpdate = useCallback(() => {
    updater.mutate(plugin.id, {
      onError: (error) => {
        // An update that asks for more than was granted goes back through consent.
        if (error instanceof PluginRequestError && error.code === "consent_required") {
          setView({
            kind: "consent",
            mode: "update",
            plugin,
            addedCapabilities: error.capabilities ?? [],
          });
        }
      },
    });
  }, [plugin, setView, updater]);
  const handleUninstall = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("plugins.installed.uninstallTitle", { name: plugin.name }),
      message: t("plugins.installed.uninstallMessage", { name: plugin.name }),
      confirmLabel: t("plugins.installed.uninstall"),
      destructive: true,
    });
    if (confirmed) remover.mutate(plugin.id);
  }, [plugin.id, plugin.name, remover, t]);
  const handleUnlink = useCallback(() => unlinker.mutate(plugin.id), [plugin.id, unlinker]);
  const handleSettings = useCallback(
    () => setView({ kind: "settings", pluginId: plugin.id, pluginName: plugin.name }),
    [plugin.id, plugin.name, setView],
  );
  const showUpdateError =
    failure !== null &&
    !(failure instanceof PluginRequestError && failure.code === "consent_required");

  return (
    <View style={styles.row} testID={`plugins-installed-${plugin.id}`}>
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {plugin.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {t("plugins.installed.meta", { id: plugin.id, version: plugin.version })}
          </Text>
        </View>
        <Switch
          value={plugin.enabled}
          onValueChange={handleToggle}
          disabled={busy}
          accessibilityLabel={t("plugins.installed.enable", { name: plugin.name })}
          testID={`plugins-enable-${plugin.id}`}
        />
      </View>
      <InstalledRowDetails plugin={plugin} />
      {showUpdateError ? <Text style={styles.error}>{describePluginError(failure)}</Text> : null}
      <View style={styles.actions}>
        {plugin.updateAvailable && !isDev ? (
          <Button
            size="sm"
            onPress={handleUpdate}
            loading={updater.isPending}
            disabled={busy}
            testID={`plugins-update-${plugin.id}`}
          >
            {t("plugins.installed.update")}
          </Button>
        ) : null}
        {hasSettings ? (
          <Button
            variant="secondary"
            size="sm"
            onPress={handleSettings}
            disabled={busy}
            testID={`plugins-settings-${plugin.id}`}
          >
            {t("plugins.installed.settings")}
          </Button>
        ) : null}
        {isDev ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleUnlink}
            loading={unlinker.isPending}
            disabled={busy}
            testID={`plugins-unlink-${plugin.id}`}
          >
            {t("plugins.installed.unlink")}
          </Button>
        ) : null}
        {!isDev && !plugin.preinstalled ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleUninstall}
            loading={remover.isPending}
            disabled={busy}
            testID={`plugins-uninstall-${plugin.id}`}
          >
            {t("plugins.installed.uninstall")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

/** Badges, description and status lines for one installed plugin. */
function InstalledRowDetails({ plugin }: { plugin: PluginInstalled }): ReactElement {
  const { t } = useTranslation();
  const isDev = plugin.source === "dev";
  return (
    <>
      <View style={styles.badges}>
        <PluginStatusBadge status={plugin.status} />
        <PluginTierBadge tier={plugin.source} />
        {isDev ? <StatusBadge label={t("plugins.devBadge")} variant="warning" /> : null}
        {plugin.updateAvailable ? (
          <StatusBadge
            label={t("plugins.installed.updateAvailable", { version: plugin.updateAvailable })}
            variant="success"
          />
        ) : null}
      </View>
      {plugin.description ? <Text style={styles.body}>{plugin.description}</Text> : null}
      {plugin.scope === "hybrid" ? (
        <Text style={styles.meta} testID={`plugins-needs-client-${plugin.id}`}>
          {t("plugins.installed.needsClientComponent")}
        </Text>
      ) : null}
      {isDev && plugin.devPath ? <Text style={styles.meta}>{plugin.devPath}</Text> : null}
      {plugin.error ? <Text style={styles.error}>{plugin.error}</Text> : null}
    </>
  );
}
