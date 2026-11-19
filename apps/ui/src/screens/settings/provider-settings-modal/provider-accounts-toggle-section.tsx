import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Switch, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isProviderAccountCapabilityUnverified } from "@frogg/protocol/provider-accounts";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useProviderAccounts } from "@/provider-accounts/use-provider-accounts";

/**
 * Owner control for a provider's extra-account support, the in-app equivalent
 * of `providerAccounts.<provider>.enabled` in config.json. Hidden when the
 * daemon cannot change it or the provider has no account support at all.
 */
export function ProviderAccountsToggleSection({
  serverId,
  providerId,
}: {
  serverId: string;
  providerId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const accounts = useProviderAccounts(serverId);
  const [error, setError] = useState<string | null>(null);
  const capability =
    accounts.payload?.capabilities.find((candidate) => candidate.provider === providerId) ?? null;
  const { setEnabled } = accounts;

  const handleToggle = useCallback(
    (enabled: boolean) => {
      setError(null);
      setEnabled.mutate(
        { provider: providerId, enabled },
        {
          onSuccess: (payload) => setError(payload.error ?? null),
          onError: (cause) => setError(cause.message),
        },
      );
    },
    [providerId, setEnabled],
  );

  if (!accounts.canSetEnabled || !capability) return null;
  const unverified = isProviderAccountCapabilityUnverified(capability);

  return (
    <SettingsSection
      title={t("settings.providers.settingsModal.accounts.title")}
      testID="provider-settings-accounts-toggle-section"
      flush
    >
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.providers.settingsModal.accounts.enable")}
            </Text>
            <Text style={styles.description}>
              {unverified
                ? t("settings.providers.settingsModal.accounts.enableDescriptionUnverified")
                : t("settings.providers.settingsModal.accounts.enableDescription")}
            </Text>
          </View>
          <Switch
            value={capability.enabled}
            onValueChange={handleToggle}
            disabled={setEnabled.isPending}
            testID="provider-settings-accounts-toggle"
          />
        </View>
        {error ? (
          <Text style={settingsStyles.rowError} testID="provider-settings-accounts-toggle-error">
            {error}
          </Text>
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
