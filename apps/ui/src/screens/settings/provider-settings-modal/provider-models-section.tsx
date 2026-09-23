import { FileText, Plus, RotateCw, Trash2 } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SettingsSection } from "@/screens/settings/settings-section";
import { Button } from "@/components/ui/button";
import {
  AddCustomModelSheet,
  ProviderDiagnosticReportSheet,
} from "@/components/provider-model-sheets";
import { settingsStyles } from "@/styles/settings";
import {
  resolveProviderDiscoveredModels,
  type ProviderDiscoveredModelsCache,
} from "@/components/provider-diagnostic-models";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { ProviderProfileModel } from "@frogg/protocol/provider-config";

const ThemedTrash = withUnistyles(Trash2, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.destructive,
}));

export interface ProviderModelsSectionProps {
  serverId: string;
  providerId: string;
}

function CustomModelRow({
  model,
  deleting,
  isFirst,
  onDelete,
}: {
  model: ProviderProfileModel;
  deleting: boolean;
  isFirst: boolean;
  onDelete: (modelId: string) => void;
}) {
  const { t } = useTranslation();
  const handleDelete = useCallback(() => onDelete(model.id), [model.id, onDelete]);
  const deleteButtonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.iconButton,
      (Boolean(hovered) || pressed) && styles.iconButtonHovered,
      deleting ? styles.disabled : null,
    ],
    [deleting],
  );

  return (
    <View
      style={[settingsStyles.row, isFirst ? null : settingsStyles.rowBorder]}
      testID={`provider-settings-custom-model-row-${model.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {model.label}
        </Text>
        <Text style={styles.modelId} numberOfLines={1}>
          {model.id}
        </Text>
      </View>
      <Pressable
        onPress={handleDelete}
        disabled={deleting}
        hitSlop={8}
        style={deleteButtonStyle}
        accessibilityRole="button"
        accessibilityLabel={t("settings.providers.models.removeModel", {
          id: model.id,
        })}
      >
        <ThemedTrash />
      </Pressable>
    </View>
  );
}

/**
 * The provider's model catalogue: what the CLI reports, plus any model ids
 * added by hand, with the actions that change or explain that list. Which
 * models an account may run is an account setting and lives on that account's
 * tab, so nothing here is per-account.
 */
export function ProviderModelsSection({
  serverId,
  providerId,
}: ProviderModelsSectionProps): ReactElement {
  const { t } = useTranslation();
  const { entries, refresh, isRefreshing } = useProvidersSnapshot(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [diagSheetOpen, setDiagSheetOpen] = useState(false);
  const [deletingModelId, setDeletingModelId] = useState<string | null>(null);

  const entry = useMemo(
    () => entries?.find((candidate) => candidate.provider === providerId),
    [entries, providerId],
  );
  // A refresh empties the snapshot's model list for a beat; holding the last
  // one keeps the catalogue from flashing empty and back.
  const discoveredCacheRef = useRef<ProviderDiscoveredModelsCache | null>(null);
  const { models, cache } = resolveProviderDiscoveredModels({
    serverId,
    provider: providerId,
    currentModels: entry?.models,
    providerSnapshotRefreshing: entry?.status === "loading",
    previousCache: discoveredCacheRef.current,
  });
  discoveredCacheRef.current = cache;
  const additionalModels = useMemo(
    () => config?.providers?.[providerId]?.additionalModels ?? [],
    [config?.providers, providerId],
  );
  const refreshing = isRefreshing || entry?.status === "loading";

  const handleRefresh = useCallback(() => {
    void refresh([providerId]);
  }, [providerId, refresh]);
  const handleOpenAddSheet = useCallback(() => setAddSheetOpen(true), []);
  const handleCloseAddSheet = useCallback(() => setAddSheetOpen(false), []);
  const handleOpenDiagSheet = useCallback(() => setDiagSheetOpen(true), []);
  const handleCloseDiagSheet = useCallback(() => setDiagSheetOpen(false), []);

  const handleDeleteCustom = useCallback(
    (modelId: string) => {
      setDeletingModelId(modelId);
      void patchConfig({
        providers: {
          [providerId]: {
            additionalModels: additionalModels.filter((model) => model.id !== modelId),
          },
        },
      })
        .then(() => refresh([providerId]))
        .finally(() => {
          setDeletingModelId((current) => (current === modelId ? null : current));
        });
    },
    [additionalModels, patchConfig, providerId, refresh],
  );

  return (
    <>
      <SettingsSection
        title={t("settings.providers.settingsModal.models.title")}
        testID="provider-settings-models-section"
        flush
      >
        <View style={settingsStyles.card}>
          {models.length === 0 && additionalModels.length === 0 ? (
            <Text style={styles.message} testID="provider-settings-models-empty">
              {t("settings.providers.settingsModal.models.empty")}
            </Text>
          ) : (
            <>
              {models.map((model, index) => (
                <View
                  key={model.id}
                  style={[settingsStyles.row, index === 0 ? null : settingsStyles.rowBorder]}
                  testID={`provider-settings-model-row-${model.id}`}
                >
                  <View style={settingsStyles.rowContent}>
                    <Text style={settingsStyles.rowTitle} numberOfLines={1}>
                      {model.label}
                    </Text>
                    <Text style={styles.modelId} numberOfLines={1}>
                      {model.id}
                    </Text>
                  </View>
                </View>
              ))}
              {additionalModels.map((model, index) => (
                <CustomModelRow
                  key={model.id}
                  model={model}
                  deleting={deletingModelId === model.id}
                  isFirst={models.length === 0 && index === 0}
                  onDelete={handleDeleteCustom}
                />
              ))}
            </>
          )}
        </View>

        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={Plus}
            onPress={handleOpenAddSheet}
            testID="provider-settings-models-add"
          >
            {t("settings.providers.models.addModel")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={FileText}
            onPress={handleOpenDiagSheet}
            testID="provider-settings-models-diagnostic"
          >
            {t("settings.providers.diagnostic.button")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={refreshing ? undefined : RotateCw}
            onPress={handleRefresh}
            disabled={refreshing}
            testID="provider-settings-models-refresh"
          >
            {refreshing
              ? t("settings.providers.diagnostic.refreshing")
              : t("settings.providers.diagnostic.refresh")}
          </Button>
        </View>
      </SettingsSection>

      <AddCustomModelSheet
        provider={providerId}
        serverId={serverId}
        visible={addSheetOpen}
        onClose={handleCloseAddSheet}
        refresh={refresh}
      />
      <ProviderDiagnosticReportSheet
        provider={providerId}
        serverId={serverId}
        visible={diagSheetOpen}
        onClose={handleCloseDiagSheet}
      />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  modelId: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  iconButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  disabled: {
    opacity: 0.5,
  },
}));
