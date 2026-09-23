import { useCallback, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Pressable,
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { settingsStyles } from "@/styles/settings";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useProviderUpdates } from "@/provider-updates/use-provider-updates";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import {
  buildAcpProviderConfigPatch,
  type AcpProviderCatalogItem,
} from "@/hooks/use-acp-provider-catalog";
import { ProviderCatalogList } from "@/components/provider-catalog-list";
import { getProviderIcon } from "@/components/provider-icons";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/screens/settings/settings-section";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { Settings } from "lucide-react-native";
import { ProviderSettingsModal } from "@/screens/settings/provider-settings-modal/provider-settings-modal";

export type ProviderDefinition = ReturnType<typeof buildProviderDefinitions>[number];
export type ProviderEntry = NonNullable<ReturnType<typeof useProvidersSnapshot>["entries"]>[number];

export type StatusTone = "success" | "warning" | "danger" | "muted" | "loading";

export interface ProviderStatus {
  tone: StatusTone;
  label: string;
  modelCount: number | null;
}

export function getProviderStatus(
  status: string,
  enabled: boolean,
  modelCount: number,
  t: TFunction,
): ProviderStatus {
  if (!enabled)
    return {
      tone: "muted",
      label: t("settings.providers.statuses.disabled"),
      modelCount: null,
    };
  if (status === "loading") {
    return {
      tone: "loading",
      label: t("settings.providers.statuses.loading"),
      modelCount: null,
    };
  }
  if (status === "error") {
    return {
      tone: "danger",
      label: t("settings.providers.statuses.error"),
      modelCount: null,
    };
  }
  if (status === "ready") {
    return {
      tone: "success",
      label: t("settings.providers.statuses.available"),
      modelCount: modelCount > 0 ? modelCount : null,
    };
  }
  return {
    tone: "warning",
    label: t("settings.providers.statuses.notInstalled"),
    modelCount: null,
  };
}

interface ProviderRowProps {
  def: ProviderDefinition;
  entry: ProviderEntry;
  enabled: boolean;
  isToggling: boolean;
  isInstalled: boolean;
  isFirst: boolean;
  /** A newer release of this provider's CLI is published. */
  hasUpdate: boolean;
  onPress: (providerId: string) => void;
  onToggleEnabled: (providerId: string, enabled: boolean) => void;
}

function stopPressInPropagation(event: GestureResponderEvent) {
  event.stopPropagation();
}

function ProviderRow({
  def,
  entry,
  enabled,
  isToggling,
  isInstalled,
  isFirst,
  hasUpdate,
  onPress,
  onToggleEnabled,
}: ProviderRowProps) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const isCompact = useIsCompactFormFactor();
  const ProviderIcon = getProviderIcon(def.id);
  const providerError =
    enabled &&
    entry.status === "error" &&
    typeof entry.error === "string" &&
    entry.error.trim().length > 0
      ? entry.error.trim()
      : null;
  const modelCount = filterSelectableModels(entry.models ?? null)?.length ?? 0;
  const providerStatus = getProviderStatus(entry.status, enabled, modelCount, t);

  const handlePress = useCallback(() => {
    onPress(def.id);
  }, [def.id, onPress]);
  const handleToggleValueChange = useCallback(
    (value: boolean) => {
      onToggleEnabled(def.id, value);
    },
    [def.id, onToggleEnabled],
  );
  const rowStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      settingsStyles.row,
      !isFirst && settingsStyles.rowBorder,
      styles.row,
      hovered && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [isFirst],
  );
  const settingsButtonStyle = useCallback(
    ({ pressed, hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.menuButton,
      hovered && styles.menuButtonHovered,
      pressed && styles.menuButtonPressed,
    ],
    [],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={t("settings.providers.providerDetails", {
        name: def.label,
      })}
    >
      {() => (
        <>
          <View style={styles.rowContent}>
            <ProviderIcon size={theme.iconSize.md} color={theme.colors.foreground} />
            <View style={styles.textColumn}>
              <View style={styles.titleRow}>
                <Text style={settingsStyles.rowTitle} numberOfLines={1}>
                  {def.label}
                </Text>
                {!isCompact ? <Text style={styles.separator}>·</Text> : null}
                <StatusIndicator status={providerStatus} compact={isCompact} />
                {hasUpdate ? (
                  <View style={styles.updateBadge} testID={`provider-update-badge-${def.id}`}>
                    <Text style={styles.updateBadgeText}>
                      {t("settings.providers.settingsModal.version.badge")}
                    </Text>
                  </View>
                ) : null}
              </View>
              {providerError && !isCompact ? (
                <Text style={styles.errorText} numberOfLines={3}>
                  {providerError}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.trailingControls}>
            <Switch
              value={enabled}
              onValueChange={handleToggleValueChange}
              disabled={isToggling}
              accessibilityLabel={t("settings.providers.enableProvider", {
                name: def.label,
              })}
            />
            <View style={styles.menuSlot}>
              {isInstalled ? (
                <Pressable
                  hitSlop={8}
                  onPress={handlePress}
                  onPressIn={stopPressInPropagation}
                  style={settingsButtonStyle}
                  accessibilityRole="button"
                  accessibilityLabel={t("settings.providers.actions.settings", {
                    name: def.label,
                  })}
                  testID={`provider-settings-${def.id}`}
                >
                  {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => (
                    <Settings
                      size={theme.iconSize.sm}
                      color={hovered ? theme.colors.foreground : theme.colors.foregroundMuted}
                    />
                  )}
                </Pressable>
              ) : null}
            </View>
          </View>
        </>
      )}
    </Pressable>
  );
}

export function getDotColor(
  tone: StatusTone,
  theme: ReturnType<typeof useUnistyles>["theme"],
): string {
  switch (tone) {
    case "success":
      return theme.colors.statusSuccess;
    case "warning":
      return theme.colors.statusWarning;
    case "danger":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

function StatusIndicator({ status, compact }: { status: ProviderStatus; compact: boolean }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const dotStyle = useMemo(
    () => [styles.statusDot, { backgroundColor: getDotColor(status.tone, theme) }],
    [status.tone, theme],
  );

  return (
    <View style={styles.statusRow}>
      {status.tone === "loading" ? (
        <LoadingSpinner size={10} color={theme.colors.foregroundMuted} />
      ) : (
        <View style={dotStyle} />
      )}
      {!compact ? (
        <>
          <Text style={styles.statusLabel}>{status.label}</Text>
          {status.modelCount !== null ? (
            <>
              <Text style={styles.separator}>·</Text>
              <Text style={styles.statusLabel}>
                {status.modelCount === 1
                  ? t("settings.providers.models.one")
                  : t("settings.providers.models.many", {
                      count: status.modelCount,
                    })}
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

export interface ProvidersSectionProps {
  serverId: string;
}

export function ProvidersSection({ serverId }: ProvidersSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries, isLoading, refresh } = useProvidersSnapshot(serverId);
  // Badging the list row is the only place an available update is visible
  // without opening a provider, so it drives discovery of the Version card.
  const providerUpdates = useProviderUpdates(serverId);
  const providersWithUpdates = useMemo(
    () =>
      new Set(
        providerUpdates.entries
          .filter((entry) => entry.status === "update-available" && entry.updatable)
          .map((entry) => entry.provider),
      ),
    [providerUpdates.entries],
  );
  const { patchConfig } = useDaemonConfig(serverId);
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null);
  const [installingProviderId, setInstallingProviderId] = useState<string | null>(null);
  const [settingsModalProviderId, setSettingsModalProviderId] = useState<string | null>(null);

  const providerDefinitions = useMemo(() => buildProviderDefinitions(entries), [entries]);
  const hasServer = serverId.length > 0;

  const handleToggleEnabled = useCallback(
    async (providerId: string, enabled: boolean) => {
      setPendingProviderId(providerId);
      try {
        await patchConfig({ providers: { [providerId]: { enabled } } });
      } catch (error) {
        Alert.alert(
          t("settings.providers.updateErrorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setPendingProviderId((current) => (current === providerId ? null : current));
      }
    },
    [patchConfig, t],
  );

  const handleOpenSettings = useCallback((providerId: string) => {
    setSettingsModalProviderId(providerId);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setSettingsModalProviderId(null);
  }, []);

  const handleInstall = useCallback(
    async (entry: AcpProviderCatalogItem) => {
      if (installingProviderId) return;
      setInstallingProviderId(entry.id);
      try {
        await patchConfig(buildAcpProviderConfigPatch(entry));
        await refresh([entry.id]);
      } catch (error) {
        Alert.alert(
          t("settings.providers.addErrorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setInstallingProviderId((current) => (current === entry.id ? null : current));
      }
    },
    [installingProviderId, patchConfig, refresh, t],
  );

  return (
    <>
      <SettingsSection
        title={t("settings.providers.title")}
        testID="host-page-providers-card"
        style={styles.sectionSpacing}
      >
        {!hasServer || !isConnected ? (
          <View style={[settingsStyles.card, styles.emptyCard]}>
            <Text style={styles.emptyText}>{t("settings.providers.unavailable")}</Text>
          </View>
        ) : null}
        {hasServer && isConnected && isLoading ? (
          <View style={[settingsStyles.card, styles.emptyCard]}>
            <Text style={styles.emptyText}>{t("settings.providers.loading")}</Text>
          </View>
        ) : null}
        {hasServer && isConnected && !isLoading && providerDefinitions.length > 0 ? (
          <View style={settingsStyles.card}>
            {providerDefinitions.map((def, index) => {
              const entry = entries?.find((candidate) => candidate.provider === def.id);
              if (!entry) return null;
              return (
                <ProviderRow
                  key={def.id}
                  def={def}
                  entry={entry}
                  enabled={entry.enabled ?? true}
                  isToggling={pendingProviderId === def.id}
                  isInstalled={entry.status !== "unavailable"}
                  isFirst={index === 0}
                  hasUpdate={providersWithUpdates.has(def.id)}
                  onPress={handleOpenSettings}
                  onToggleEnabled={handleToggleEnabled}
                />
              );
            })}
          </View>
        ) : null}
      </SettingsSection>

      {hasServer && isConnected ? (
        <SettingsSection
          title={t("settings.providers.addProvider")}
          testID="host-page-add-provider-card"
          style={styles.addProviderSection}
        >
          <ProviderCatalogList
            serverId={serverId}
            installingProviderId={installingProviderId}
            onInstall={handleInstall}
          />
        </SettingsSection>
      ) : null}

      {settingsModalProviderId ? (
        <ProviderSettingsModal
          serverId={serverId}
          providerId={settingsModalProviderId}
          visible
          onClose={handleCloseSettings}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionSpacing: {
    marginBottom: theme.spacing[4],
  },
  addProviderSection: {
    marginTop: theme.spacing[4],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  row: {
    gap: theme.spacing[3],
    minHeight: 56,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  rowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  updateBadge: {
    backgroundColor: theme.colors.statusWarning,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
  },
  updateBadgeText: {
    color: theme.colors.background,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  separator: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  trailingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  menuButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  menuSlot: {
    width: 32,
    height: 32,
  },
  menuButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  menuButtonPressed: {
    backgroundColor: theme.colors.surface3,
  },
}));
