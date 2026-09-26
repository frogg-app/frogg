/**
 * COMPAT(hostResources): added in v1.6.0.
 *
 * Host Resources: live CPU/memory/disk and daemon-process load, the size of
 * each Frogg-owned storage category, and cleanup for the categories the daemon
 * marks cleanable. Metrics poll only while the settings screen is focused.
 */
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useIsFocused } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { RotateCw, Trash2 } from "lucide-react-native";
import type { HostMetrics, OwnedStorageCategory } from "@frogg/protocol/messages";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/i18n/i18next";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { formatBytes } from "./daemon-update-progress";
import {
  HOST_METRICS_POLL_MS,
  canCleanCategory,
  formatCategorySize,
  formatLoadAverage,
  formatPercent,
  formatUsage,
  isKnownStorageCategoryId,
  sortStorageCategories,
  splitUptime,
  totalStorageBytes,
  usageFraction,
} from "./host-resources-view";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function HostResourcesSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const supported = useHostFeature(serverId, "hostResources");
  const isConnected = useHostRuntimeIsConnected(serverId);
  if (!supported || !isConnected) return null;
  return (
    <SettingsSection
      title={t("settings.host.resources.title")}
      info={t("settings.host.resources.info")}
      testID="host-page-resources"
    >
      <HostMetricsCard serverId={serverId} />
      <OwnedStorageCard serverId={serverId} />
    </SettingsSection>
  );
}

function HostMetricsCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isFocused = useIsFocused();
  const query = useFetchQuery({
    queryKey: ["host-resources", serverId, "metrics"],
    queryFn: async () => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.getHostMetrics();
      if (payload.error || !payload.metrics) {
        throw new Error(payload.error ?? t("settings.host.resources.metricsUnavailable"));
      }
      return payload.metrics;
    },
    enabled: Boolean(client) && isFocused,
    dataShape: "value",
    staleTimeMs: HOST_METRICS_POLL_MS,
    refetchInterval: isFocused ? HOST_METRICS_POLL_MS : false,
    retry: 1,
  });

  if (!query.data) {
    if (query.error) {
      return (
        <Alert
          variant="error"
          title={t("settings.host.resources.metricsFailed")}
          description={errorMessage(query.error)}
          testID="host-page-resources-metrics-error"
        />
      );
    }
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>{t("settings.host.resources.loading")}</Text>
        </View>
      </View>
    );
  }
  return <MetricsRows metrics={query.data} stale={Boolean(query.error)} />;
}

function MetricsRows({ metrics, stale }: { metrics: HostMetrics; stale: boolean }) {
  const { t } = useTranslation();
  const uptime = (seconds: number) =>
    t("settings.host.resources.uptimeValue", { ...splitUptime(seconds) });
  const cpuPercent = formatPercent(metrics.cpu.usagePercent);
  const load = formatLoadAverage(metrics.cpu.loadAverage);
  const cpuHint = [
    t("settings.host.resources.cores", { count: metrics.cpu.cores }),
    metrics.cpu.model,
    load ? t("settings.host.resources.load", { value: load }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const daemonCpu = formatPercent(metrics.daemon.cpuPercent);

  return (
    <View style={settingsStyles.card} testID="host-page-resources-metrics">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{metrics.hostname}</Text>
          <Text style={settingsStyles.rowHint}>
            {`${metrics.platform} · ${metrics.arch} · ${t("settings.host.resources.uptime", {
              value: uptime(metrics.uptimeSeconds),
            })}`}
          </Text>
          {stale ? (
            <Text style={settingsStyles.rowError}>{t("settings.host.resources.stale")}</Text>
          ) : null}
        </View>
      </View>
      <UsageRow
        title={t("settings.host.resources.cpu")}
        value={cpuPercent ?? t("settings.host.resources.notAvailable")}
        hint={cpuHint}
        fraction={metrics.cpu.usagePercent === null ? null : metrics.cpu.usagePercent / 100}
        testID="host-page-resources-cpu"
      />
      <UsageRow
        title={t("settings.host.resources.memory")}
        value={formatUsage(metrics.memory.usedBytes, metrics.memory.totalBytes)}
        fraction={usageFraction(metrics.memory.usedBytes, metrics.memory.totalBytes)}
        testID="host-page-resources-memory"
      />
      {metrics.disk ? (
        <UsageRow
          title={t("settings.host.resources.disk")}
          value={formatUsage(metrics.disk.usedBytes, metrics.disk.totalBytes)}
          hint={t("settings.host.resources.diskHint", {
            path: metrics.disk.path,
            free: formatBytes(metrics.disk.freeBytes),
          })}
          fraction={usageFraction(metrics.disk.usedBytes, metrics.disk.totalBytes)}
          testID="host-page-resources-disk"
        />
      ) : null}
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.resources.daemon")}</Text>
          <Text style={settingsStyles.rowHint}>
            {[
              t("settings.host.resources.daemonPid", {
                pid: metrics.daemon.pid,
              }),
              t("settings.host.resources.daemonMemory", {
                rss: formatBytes(metrics.daemon.rssBytes),
                heap: formatBytes(metrics.daemon.heapUsedBytes),
              }),
              daemonCpu ? t("settings.host.resources.daemonCpu", { value: daemonCpu }) : null,
              t("settings.host.resources.uptime", {
                value: uptime(metrics.daemon.uptimeSeconds),
              }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
      </View>
    </View>
  );
}

function UsageRow({
  title,
  value,
  hint,
  fraction,
  testID,
}: {
  title: string;
  value: string;
  hint?: string;
  fraction: number | null;
  testID: string;
}) {
  const clamped = fraction === null ? null : Math.min(1, Math.max(0, fraction));
  const accessibilityValue = useMemo(
    () => (clamped === null ? undefined : { now: Math.round(clamped * 100), min: 0, max: 100 }),
    [clamped],
  );
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder, styles.usageRow]} testID={testID}>
      <View style={styles.usageHeader}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={styles.usageValue}>{value}</Text>
      </View>
      {clamped === null ? null : (
        <View
          style={styles.track}
          accessibilityRole="progressbar"
          accessibilityLabel={title}
          accessibilityValue={accessibilityValue}
        >
          <View
            style={[
              styles.fill,
              clamped >= 0.9 ? styles.fillCritical : null,
              { width: `${Math.round(clamped * 100)}%` },
            ]}
          />
        </View>
      )}
      {hint ? <Text style={settingsStyles.rowHint}>{hint}</Text> : null}
    </View>
  );
}

type CleanResult =
  | {
      kind: "success";
      categoryId: string;
      bytesFreed: number;
      removedCount: number;
    }
  | { kind: "error"; categoryId: string; message: string };

function OwnedStorageCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const [refreshing, setRefreshing] = useState(false);
  const [cleanResult, setCleanResult] = useState<CleanResult | null>(null);
  const queryKey = useMemo(() => ["host-resources", serverId, "storage"], [serverId]);

  const fetchStorage = useCallback(
    async (refresh: boolean) => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.listOwnedStorage(refresh ? { refresh: true } : undefined);
      if (payload.error) throw new Error(payload.error);
      return payload;
    },
    [client],
  );

  const query = useFetchQuery({
    queryKey,
    queryFn: () => fetchStorage(false),
    enabled: Boolean(client),
    dataShape: "value",
    staleTimeMs: 60_000,
    retry: false,
  });

  const refetch = query.refetch;
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Bust the daemon's cache first, then let the query pick up the fresh result.
      await fetchStorage(true);
    } catch {
      // The refetch below surfaces the error state.
    } finally {
      await refetch();
      setRefreshing(false);
    }
  }, [fetchStorage, refetch]);

  const handleRefreshPress = useCallback(() => void handleRefresh(), [handleRefresh]);

  const clean = useMutation({
    mutationFn: async (categoryId: string) => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.cleanOwnedStorage(categoryId);
      if (payload.error) throw new Error(payload.error);
      return payload;
    },
    onSuccess: (payload, categoryId) => {
      setCleanResult({
        kind: "success",
        categoryId,
        bytesFreed: payload.bytesFreed,
        removedCount: payload.removedCount,
      });
      void handleRefresh();
    },
    onError: (error, categoryId) => {
      setCleanResult({
        kind: "error",
        categoryId,
        message: errorMessage(error),
      });
    },
  });

  const categoryLabel = useCallback(
    (id: string) =>
      isKnownStorageCategoryId(id) ? t(`settings.host.resources.categories.${id}`) : id,
    [t],
  );

  const mutate = clean.mutate;
  const handleClean = useCallback(
    (category: OwnedStorageCategory) => {
      const label = categoryLabel(category.id);
      void confirmDialog({
        title: t("settings.host.resources.cleanConfirmTitle", {
          category: label,
        }),
        message: t("settings.host.resources.cleanConfirmMessage", {
          category: label,
          size: formatBytes(category.reclaimableBytes ?? 0),
        }),
        confirmLabel: t("settings.host.resources.clean"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }).then((confirmed) => {
        if (!confirmed) return false;
        setCleanResult(null);
        mutate(category.id);
        return true;
      });
    },
    [categoryLabel, mutate, t],
  );

  const categories = useMemo(
    () => (query.data ? sortStorageCategories(query.data.categories) : []),
    [query.data],
  );
  const total = useMemo(() => totalStorageBytes(categories), [categories]);

  const refreshButton = (
    <Button
      variant="outline"
      size="sm"
      leftIcon={RotateCw}
      onPress={handleRefreshPress}
      loading={refreshing}
      testID="host-page-resources-storage-refresh"
    >
      {t("settings.host.resources.refresh")}
    </Button>
  );

  if (!query.data) {
    if (query.error) {
      // Viewers (and a failed walk) still get the metrics above; only storage is missing.
      return (
        <Alert
          variant="info"
          title={t("settings.host.resources.storageUnavailable")}
          description={errorMessage(query.error)}
          testID="host-page-resources-storage-error"
        >
          {refreshButton}
        </Alert>
      );
    }
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>{t("settings.host.resources.storageLoading")}</Text>
        </View>
      </View>
    );
  }

  const totalSize = formatCategorySize(total);
  return (
    <View style={settingsStyles.card} testID="host-page-resources-storage">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.resources.storageTitle", { size: totalSize })}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {query.data.computedAt
              ? t("settings.host.resources.computedAt", {
                  time: new Date(query.data.computedAt).toLocaleTimeString(),
                })
              : t("settings.host.resources.storageHint")}
          </Text>
          {query.error ? (
            <Text style={settingsStyles.rowError}>{errorMessage(query.error)}</Text>
          ) : null}
        </View>
        {refreshButton}
      </View>
      {cleanResult ? (
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={styles.resultAlert}>
            {cleanResult.kind === "success" ? (
              <Alert
                variant="success"
                description={t("settings.host.resources.cleanSuccess", {
                  category: categoryLabel(cleanResult.categoryId),
                  size: formatBytes(cleanResult.bytesFreed),
                  count: cleanResult.removedCount,
                })}
                testID="host-page-resources-clean-success"
              />
            ) : (
              <Alert
                variant="error"
                title={t("settings.host.resources.cleanFailed", {
                  category: categoryLabel(cleanResult.categoryId),
                })}
                description={cleanResult.message}
                testID="host-page-resources-clean-error"
              />
            )}
          </View>
        </View>
      ) : null}
      {categories.map((category) => {
        const cleaning = clean.isPending && clean.variables === category.id;
        return (
          <View
            key={category.id}
            style={[settingsStyles.row, settingsStyles.rowBorder]}
            testID={`host-page-resources-storage-${category.id}`}
          >
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{categoryLabel(category.id)}</Text>
              <Text style={settingsStyles.rowHint} numberOfLines={2}>
                {category.exists
                  ? [
                      formatCategorySize(category),
                      t("settings.host.resources.entries", {
                        count: category.entryCount,
                      }),
                      category.path,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : t("settings.host.resources.missing")}
              </Text>
            </View>
            {category.cleanable ? (
              <CleanButton
                category={category}
                cleaning={cleaning}
                disabled={!canCleanCategory(category) || clean.isPending}
                onClean={handleClean}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function CleanButton({
  category,
  cleaning,
  disabled,
  onClean,
}: {
  category: OwnedStorageCategory;
  cleaning: boolean;
  disabled: boolean;
  onClean: (category: OwnedStorageCategory) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onClean(category), [category, onClean]);
  return (
    <Button
      variant="outline"
      size="sm"
      leftIcon={Trash2}
      loading={cleaning}
      disabled={disabled}
      onPress={handlePress}
      testID={`host-page-resources-clean-${category.id}`}
    >
      {t("settings.host.resources.clean")}
    </Button>
  );
}

const styles = StyleSheet.create((theme) => ({
  usageRow: {
    flexDirection: "column",
    alignItems: "stretch",
    flexWrap: "nowrap",
    gap: theme.spacing[2],
  },
  usageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  usageValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  fillCritical: {
    backgroundColor: theme.colors.destructive,
  },
  resultAlert: {
    flex: 1,
  },
}));
