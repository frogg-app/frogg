import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { useFetchQuery } from "@/data/query";
import { pickDirectory } from "@/desktop/pick-directory";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { describeCapability, PluginStatusBadge, PluginTierBadge } from "./badges";
import {
  fetchClientCatalog,
  hostUserRepos,
  mergeRepos,
  type ClientCatalogEntry,
} from "./client-runtime/client-catalog";
import type { ClientPluginRecord } from "./client-runtime/records";
import {
  installClientPlugin,
  linkClientPluginFolder,
  reloadClientPlugin,
  setClientPluginEnabled,
  uninstallClientPlugin,
  useClientPluginsStore,
} from "./client-runtime/runtime-store";
import { isDesktopApp } from "./client-runtime/storage";
import { describePluginError } from "./errors";
import { isPluginDeveloperModeAllowedByBrand, usePluginHostIds } from "./hosts";
import type { PluginsTab } from "./modal-store";
import { PluginSpinner } from "./spinner";
import { pluginStyles as styles } from "./shared-styles";

type ClientTab = Exclude<PluginsTab, "repositories">;

/** "This client": plugins installed on this device (desktop and web). */
export function ClientTargetBody({
  tab,
  onTabChange,
}: {
  tab: PluginsTab;
  onTabChange: (tab: PluginsTab) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [consent, setConsent] = useState<ClientCatalogEntry | null>(null);
  const options = useMemo<SegmentedControlOption<ClientTab>[]>(
    () => [
      { value: "installed", label: t("plugins.tabs.installed"), testID: "plugins-tab-installed" },
      { value: "browse", label: t("plugins.tabs.browse"), testID: "plugins-tab-browse" },
    ],
    [t],
  );
  const current: ClientTab = tab === "browse" ? "browse" : "installed";
  const finishConsent = useCallback(
    (installed: boolean) => {
      setConsent(null);
      if (installed) onTabChange("installed");
    },
    [onTabChange],
  );
  if (consent) {
    return <ClientConsent entry={consent} onDone={finishConsent} />;
  }
  return (
    <>
      <SegmentedControl
        options={options}
        value={current}
        onValueChange={onTabChange}
        size="sm"
        testID="plugins-tabs"
      />
      {current === "browse" ? <ClientBrowse onInstall={setConsent} /> : <ClientInstalled />}
    </>
  );
}

function ClientInstalled(): ReactElement {
  const { t } = useTranslation();
  const loaded = useClientPluginsStore((s) => s.loaded);
  const loadError = useClientPluginsStore((s) => s.loadError);
  const records = useClientPluginsStore((s) => s.records);
  const sorted = useMemo(
    () => [...records].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)),
    [records],
  );
  if (!loaded) return <PluginSpinner />;
  return (
    <View style={styles.list} testID="plugins-client-installed">
      {isDesktopApp() && isPluginDeveloperModeAllowedByBrand() ? <ClientDevFolder /> : null}
      {loadError ? (
        <Text style={styles.error}>{t("plugins.client.loadFailed", { error: loadError })}</Text>
      ) : null}
      {sorted.length === 0 ? (
        <Text style={styles.empty} testID="plugins-client-empty">
          {t("plugins.client.installedEmpty")}
        </Text>
      ) : null}
      {sorted.map((record) => (
        <ClientInstalledRow key={record.id} record={record} />
      ))}
    </View>
  );
}

function ClientDevFolder(): ReactElement {
  const { t } = useTranslation();
  const [linked, setLinked] = useState<string | null>(null);
  const link = useMutation({
    mutationFn: async () => {
      const folder = await pickDirectory();
      return folder ? linkClientPluginFolder(folder) : null;
    },
    onSuccess: (record) => setLinked(record?.manifest.name ?? null),
  });
  const runLink = useCallback(() => link.mutate(), [link]);
  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title}>{t("plugins.client.addFolder")}</Text>
          <Text style={styles.meta}>{t("plugins.client.addFolderHint")}</Text>
        </View>
        <Button
          size="sm"
          variant="secondary"
          onPress={runLink}
          loading={link.isPending}
          testID="plugins-client-add-folder"
        >
          {t("plugins.client.addFolder")}
        </Button>
      </View>
      {link.error ? <Text style={styles.error}>{describePluginError(link.error)}</Text> : null}
      {linked ? (
        <Text style={styles.meta}>{t("plugins.client.linked", { name: linked })}</Text>
      ) : null}
    </View>
  );
}

function ClientInstalledRow({ record }: { record: ClientPluginRecord }): ReactElement {
  const { t } = useTranslation();
  const status = useClientPluginsStore((s) => s.status[record.id]);
  const isDev = record.source === "dev";
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => setClientPluginEnabled(record.id, enabled),
  });
  const reload = useMutation({ mutationFn: () => reloadClientPlugin(record.id) });
  const remove = useMutation({ mutationFn: () => uninstallClientPlugin(record.id) });
  const busy = toggle.isPending || reload.isPending || remove.isPending;
  const runReload = useCallback(() => reload.mutate(), [reload]);
  const failure = toggle.error ?? reload.error ?? remove.error;
  const handleUninstall = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("plugins.installed.uninstallTitle", { name: record.manifest.name }),
      message: t("plugins.installed.uninstallMessage", { name: record.manifest.name }),
      confirmLabel: t("plugins.installed.uninstall"),
      destructive: true,
    });
    if (confirmed) remove.mutate();
  }, [record.manifest.name, remove, t]);
  const state = status?.state ?? "starting";

  return (
    <View style={styles.row} testID={`plugins-client-installed-${record.id}`}>
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {record.manifest.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {t("plugins.installed.meta", { id: record.id, version: record.version })}
          </Text>
        </View>
        <Switch
          value={record.enabled}
          onValueChange={toggle.mutate}
          disabled={busy}
          accessibilityLabel={t("plugins.installed.enable", { name: record.manifest.name })}
          testID={`plugins-client-enable-${record.id}`}
        />
      </View>
      <View style={styles.badges}>
        {state === "starting" ? (
          <StatusBadge label={t("plugins.client.starting")} />
        ) : (
          <PluginStatusBadge status={state} />
        )}
        <PluginTierBadge tier={record.source} />
        {isDev ? <StatusBadge label={t("plugins.devBadge")} variant="warning" /> : null}
      </View>
      {record.manifest.description ? (
        <Text style={styles.body}>{record.manifest.description}</Text>
      ) : null}
      {isDev && record.devPath ? <Text style={styles.meta}>{record.devPath}</Text> : null}
      {status?.error ? (
        <Text style={styles.error} testID={`plugins-client-error-${record.id}`}>
          {status.error}
        </Text>
      ) : null}
      {failure ? <Text style={styles.error}>{describePluginError(failure)}</Text> : null}
      <View style={styles.actions}>
        {isDev || state === "error" ? (
          <Button
            variant="secondary"
            size="sm"
            onPress={runReload}
            loading={reload.isPending}
            disabled={busy}
            testID={`plugins-client-reload-${record.id}`}
          >
            {t("plugins.client.reload")}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onPress={handleUninstall}
          loading={remove.isPending}
          disabled={busy}
          testID={`plugins-client-uninstall-${record.id}`}
        >
          {isDev ? t("plugins.installed.unlink") : t("plugins.installed.uninstall")}
        </Button>
      </View>
    </View>
  );
}

/** Repos this device trusts: compiled official/brand, plus user repos pinned on connected hosts. */
export async function loadTrustedRepos(serverIds: readonly string[]) {
  const clients = serverIds
    .map((id) => getHostRuntimeStore().getClient(id))
    .filter((client): client is NonNullable<typeof client> => client !== null);
  return mergeRepos(await hostUserRepos(clients));
}

function ClientBrowse({
  onInstall,
}: {
  onInstall: (entry: ClientCatalogEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  const hostIds = usePluginHostIds();
  const records = useClientPluginsStore((s) => s.records);
  const catalog = useFetchQuery({
    queryKey: ["plugins", "__client__", "catalog", hostIds.join(",")],
    queryFn: async () => fetchClientCatalog((url) => fetch(url), await loadTrustedRepos(hostIds)),
    dataShape: "value",
    staleTimeMs: 5 * 60_000,
    retry: false,
  });
  const refresh = useCallback(() => void catalog.refetch(), [catalog]);
  if (catalog.isPending) return <PluginSpinner />;
  if (catalog.isError) {
    return (
      <View style={styles.toolbar}>
        <Text style={styles.error}>{describePluginError(catalog.error)}</Text>
        <Button variant="secondary" size="sm" onPress={refresh}>
          {t("plugins.browse.retry")}
        </Button>
      </View>
    );
  }
  const { entries, failures } = catalog.data;
  return (
    <View style={styles.list} testID="plugins-client-browse">
      {failures.map((f) => (
        <Text key={f.repo.url} style={styles.error}>
          {t("plugins.browse.repoFailed", { name: f.repo.name, error: f.error })}
        </Text>
      ))}
      {entries.length === 0 ? (
        <Text style={styles.empty}>{t("plugins.client.browseEmpty")}</Text>
      ) : null}
      {entries.map((entry) => (
        <ClientCatalogRow
          key={`${entry.repo.url}:${entry.id}`}
          entry={entry}
          installedVersion={records.find((r) => r.id === entry.id)?.version ?? null}
          onInstall={onInstall}
        />
      ))}
    </View>
  );
}

function ClientCatalogRow({
  entry,
  installedVersion,
  onInstall,
}: {
  entry: ClientCatalogEntry;
  installedVersion: string | null;
  onInstall: (entry: ClientCatalogEntry) => void;
}): ReactElement {
  const { t } = useTranslation();
  const install = useCallback(() => onInstall(entry), [entry, onInstall]);
  return (
    <View
      key={`${entry.repo.url}:${entry.id}`}
      style={styles.row}
      testID={`plugins-client-catalog-${entry.id}`}
    >
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {entry.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {t("plugins.installed.meta", { id: entry.id, version: entry.latest.version })}
          </Text>
        </View>
        {installedVersion ? (
          <StatusBadge
            label={t("plugins.browse.installed", { version: installedVersion })}
            variant="success"
          />
        ) : (
          <Button size="sm" onPress={install} testID={`plugins-client-install-${entry.id}`}>
            {t("plugins.browse.install")}
          </Button>
        )}
      </View>
      <View style={styles.badges}>
        <PluginTierBadge tier={entry.repo.tier} />
        <StatusBadge label={entry.repo.name} />
      </View>
      {entry.description ? <Text style={styles.body}>{entry.description}</Text> : null}
    </View>
  );
}

function ClientConsent({
  entry,
  onDone,
}: {
  entry: ClientCatalogEntry;
  onDone: (installed: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const install = useMutation({
    mutationFn: () =>
      installClientPlugin({
        repo: entry.repo,
        id: entry.id,
        version: entry.latest.version,
        grantedCapabilities: entry.latest.capabilities,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["plugins", "__client__"] });
      onDone(true);
    },
  });
  const runInstall = useCallback(() => install.mutate(), [install]);
  const cancel = useCallback(() => onDone(false), [onDone]);
  return (
    <View style={styles.list} testID="plugins-client-consent">
      <Text style={styles.title}>{t("plugins.client.consentTitle", { name: entry.name })}</Text>
      <View style={styles.badges}>
        <PluginTierBadge tier={entry.repo.tier} />
        <Text style={styles.meta}>{entry.repo.name}</Text>
      </View>
      <Text style={styles.body}>{t("plugins.client.consentIntro", { name: entry.name })}</Text>
      <View style={styles.list}>
        {entry.latest.capabilities.length === 0 ? (
          <Text style={styles.meta}>{t("plugins.consent.noCapabilities")}</Text>
        ) : null}
        {entry.latest.capabilities.map((cap) => (
          <View key={cap} style={styles.rowTitleBlock}>
            <Text style={styles.title}>{cap}</Text>
            <Text style={styles.meta}>{describeCapability(cap)}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.meta}>{t("plugins.client.sandboxed")}</Text>
      {install.error ? (
        <Text style={styles.error} testID="plugins-client-consent-error">
          {describePluginError(install.error)}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Button variant="secondary" size="sm" onPress={cancel} disabled={install.isPending}>
          {t("common.actions.cancel")}
        </Button>
        <Button
          size="sm"
          onPress={runInstall}
          loading={install.isPending}
          testID="plugins-client-consent-confirm"
        >
          {t("plugins.consent.install")}
        </Button>
      </View>
    </View>
  );
}
