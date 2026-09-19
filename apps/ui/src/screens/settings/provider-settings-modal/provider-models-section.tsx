import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";

export interface ProviderModelsSectionProps {
  serverId: string;
  providerId: string;
}

/**
 * The provider's model catalogue, read only. Which models an account may run
 * is an account setting and lives on that account's tab, so nothing here is
 * per-account.
 */
export function ProviderModelsSection({
  serverId,
  providerId,
}: ProviderModelsSectionProps): ReactElement {
  const { t } = useTranslation();
  const { entries } = useProvidersSnapshot(serverId);
  const models = useMemo(() => {
    const entry = entries?.find((candidate) => candidate.provider === providerId);
    return filterSelectableModels(entry?.models ?? null) ?? [];
  }, [entries, providerId]);

  return (
    <SettingsSection
      title={t("settings.providers.settingsModal.models.title")}
      testID="provider-settings-models-section"
      flush
    >
      <View style={settingsStyles.card}>
        {models.length === 0 ? (
          <Text style={styles.message} testID="provider-settings-models-empty">
            {t("settings.providers.settingsModal.models.empty")}
          </Text>
        ) : (
          models.map((model, index) => (
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
          ))
        )}
      </View>
    </SettingsSection>
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
}));
