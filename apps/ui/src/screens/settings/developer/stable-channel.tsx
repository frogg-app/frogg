import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { brand } from "@frogg/branding";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { resolveAppVersion } from "@/utils/app-version";

/** This app, the released build. */
export function StableAppCard() {
  const { t } = useTranslation();
  const version = resolveAppVersion();
  return (
    <SettingsSection title={t("settings.developer.sections.app")} testID="developer-stable-app">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{brand.name}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.developer.stable.thisApp", { version: version ?? "?" })}
            </Text>
          </View>
        </View>
      </View>
    </SettingsSection>
  );
}

/** Every added host's daemon, as far as this app's connection to it shows. */
export function StableDaemonHostsSection() {
  const { t } = useTranslation();
  const hosts = useHosts();
  return (
    <SettingsSection
      title={t("settings.developer.sections.daemons")}
      info={t("settings.developer.stable.daemonInfo", { port: brand.daemonPort })}
      testID="developer-stable-daemon"
    >
      <View style={settingsStyles.card}>
        {hosts.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("settings.developer.noHosts")}</Text>
          </View>
        ) : (
          hosts.map((host, index) => (
            <StableDaemonHostRow key={host.serverId} host={host} showBorder={index > 0} />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function StableDaemonHostRow({ host, showBorder }: { host: HostProfile; showBorder: boolean }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const serverInfo = useSessionStore((state) => state.sessions[host.serverId]?.serverInfo ?? null);
  const rowStyle = useMemo(
    () => [styles.hostBlock, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );

  const line = isConnected
    ? t("settings.developer.stable.connected", { version: serverInfo?.version ?? "?" })
    : t("settings.developer.offline");

  return (
    <View style={rowStyle} testID={`developer-stable-daemon-host-${host.serverId}`}>
      <Text style={settingsStyles.rowTitle} numberOfLines={1}>
        {host.label}
      </Text>
      <Text style={settingsStyles.rowHint}>{line}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hostBlock: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
}));
