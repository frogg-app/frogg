import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Switch, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SettingsSection } from "@/screens/settings/settings-section";
import { Button } from "@/components/ui/button";
import { settingsStyles } from "@/styles/settings";
import { useProviderUpdates } from "@/provider-updates/use-provider-updates";

export interface ProviderVersionSectionProps {
  serverId: string;
  providerId: string;
}

/**
 * Installed vs. published version for one provider CLI, with the update action
 * and the daemon-wide auto-update switch.
 */
export function ProviderVersionSection({
  serverId,
  providerId,
}: ProviderVersionSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const updates = useProviderUpdates(serverId);

  const entry = useMemo(
    () => updates.entries.find((candidate) => candidate.provider === providerId) ?? null,
    [providerId, updates.entries],
  );

  const handleInstall = useCallback(() => {
    void updates.install(providerId);
  }, [providerId, updates]);

  const handleRefresh = useCallback(() => {
    void updates.refresh();
  }, [updates]);

  const handleToggleAutoUpdate = useCallback(
    (value: boolean) => {
      void updates.setPreferences({ autoUpdate: value });
    },
    [updates],
  );

  if (!updates.supported) return null;

  const installing = updates.installingProvider === providerId;
  let installActionLabel = t("settings.providers.settingsModal.version.update");
  if (installing) {
    installActionLabel = t("settings.providers.settingsModal.version.updating");
  } else if (entry?.status === "not-installed") {
    installActionLabel = t("settings.providers.settingsModal.version.install");
  }
  const statusLabel = entry
    ? t(`settings.providers.settingsModal.version.status.${entry.status}`)
    : t("settings.providers.settingsModal.version.status.unknown");

  return (
    <SettingsSection
      title={t("settings.providers.settingsModal.version.title")}
      testID="provider-settings-version-section"
      flush
    >
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{statusLabel}</Text>
            <Text style={styles.versions} numberOfLines={1}>
              {t("settings.providers.settingsModal.version.installed", {
                version: entry?.installedVersion ?? "—",
              })}
              {entry?.latestVersion
                ? `  ·  ${t("settings.providers.settingsModal.version.latest", {
                    version: entry.latestVersion,
                  })}`
                : ""}
            </Text>
          </View>
          {entry?.updatable ? (
            <Button
              size="sm"
              variant={entry.status === "update-available" ? "default" : "outline"}
              onPress={handleInstall}
              disabled={installing || updates.isRefreshing}
              testID="provider-settings-version-update"
            >
              {installActionLabel}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onPress={handleRefresh}
              disabled={updates.isRefreshing}
              testID="provider-settings-version-refresh"
            >
              {t("settings.providers.settingsModal.version.refresh")}
            </Button>
          )}
        </View>

        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.providers.settingsModal.version.autoUpdate")}
            </Text>
            <Text style={styles.description}>
              {t("settings.providers.settingsModal.version.autoUpdateDescription")}
            </Text>
          </View>
          <Switch
            value={updates.preferences?.autoUpdate === true}
            onValueChange={handleToggleAutoUpdate}
            testID="provider-settings-version-auto-update"
          />
        </View>

        {updates.error ? (
          <Text style={settingsStyles.rowError} testID="provider-settings-version-error">
            {updates.error}
          </Text>
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  versions: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
