import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import type { PluginCatalogEntry } from "@frogg/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import { PluginSpinner } from "./spinner";
import { SearchField } from "@/components/ui/search-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { PluginTierBadge } from "./badges";
import { groupCatalog } from "./catalog-model";
import { describePluginError } from "./errors";
import { usePluginsModalStore } from "./modal-store";
import { usePluginsCatalog } from "./queries";
import { pluginStyles as styles } from "./shared-styles";

export function BrowseTab({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const catalog = usePluginsCatalog(serverId, true);
  const [query, setQuery] = useState("");
  const groups = useMemo(
    () => groupCatalog(catalog.data?.plugins ?? [], query),
    [catalog.data, query],
  );
  const failedRepos = useMemo(
    () => (catalog.data?.repos ?? []).filter((repo) => repo.error),
    [catalog.data],
  );
  const refresh = useCallback(() => void catalog.refetch(), [catalog]);

  return (
    <View style={styles.list} testID="plugins-browse">
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder={t("plugins.browse.search")}
        clearAccessibilityLabel={t("plugins.browse.clearSearch")}
        testID="plugins-browse-search"
      />
      {catalog.isPending ? <PluginSpinner /> : null}
      {catalog.isError ? (
        <View style={styles.toolbar}>
          <Text style={styles.error}>{describePluginError(catalog.error)}</Text>
          <Button variant="secondary" size="sm" onPress={refresh}>
            {t("plugins.browse.retry")}
          </Button>
        </View>
      ) : null}
      {failedRepos.map((repo) => (
        <Text key={repo.url} style={styles.error}>
          {t("plugins.browse.repoFailed", { name: repo.name, error: repo.error })}
        </Text>
      ))}
      {catalog.isSuccess && groups.length === 0 ? (
        <Text style={styles.empty} testID="plugins-browse-empty">
          {query ? t("plugins.browse.noMatches") : t("plugins.browse.empty")}
        </Text>
      ) : null}
      {groups.map((group) => (
        <View key={group.category ?? "__none__"} style={styles.list}>
          <Text style={styles.sectionTitle}>
            {group.category ?? t("plugins.browse.uncategorised")}
          </Text>
          {group.entries.map((entry) => (
            <CatalogRow key={`${entry.repoUrl}:${entry.id}`} entry={entry} />
          ))}
        </View>
      ))}
    </View>
  );
}

function CatalogRow({ entry }: { entry: PluginCatalogEntry }): ReactElement {
  const { t } = useTranslation();
  const setView = usePluginsModalStore((state) => state.setView);
  const install = useCallback(
    () => setView({ kind: "consent", mode: "install", entry }),
    [entry, setView],
  );
  const latest = entry.latest;
  return (
    <View style={styles.row} testID={`plugins-catalog-${entry.id}`}>
      <View style={styles.rowHeader}>
        <View style={styles.rowTitleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {entry.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {latest
              ? t("plugins.installed.meta", { id: entry.id, version: latest.version })
              : entry.id}
          </Text>
        </View>
        {entry.installedVersion ? (
          <StatusBadge
            label={t("plugins.browse.installed", { version: entry.installedVersion })}
            variant="success"
          />
        ) : (
          <Button
            size="sm"
            onPress={install}
            disabled={!latest}
            testID={`plugins-install-${entry.id}`}
          >
            {t("plugins.browse.install")}
          </Button>
        )}
      </View>
      <View style={styles.badges}>
        <PluginTierBadge tier={entry.tier} />
        <StatusBadge label={entry.repoName} />
        {latest?.scope === "hybrid" ? (
          <StatusBadge label={t("plugins.browse.needsClient")} variant="warning" />
        ) : null}
      </View>
      {entry.description ? <Text style={styles.body}>{entry.description}</Text> : null}
      {latest ? null : <Text style={styles.meta}>{t("plugins.browse.incompatible")}</Text>}
    </View>
  );
}
