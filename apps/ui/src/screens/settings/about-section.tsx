import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Trans, useTranslation } from "react-i18next";
import { brand } from "@frogg/branding";
import { Button } from "@/components/ui/button";
import { openHostOverview } from "@/navigation/settings-navigation";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { HostProfile } from "@/types/host-connection";
import { DesktopUpdatesSection } from "@/desktop/updates/desktop-updates-section";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";

const FROGG_URL = "https://github.com/frogg-app/frogg";
const PASEO_URL = "https://github.com/getpaseo/paseo";

export interface AboutSectionProps {
  appVersion: string | null;
  appVersionText: string;
  isDesktopApp: boolean;
}

export function AboutSection({ appVersion, appVersionText, isDesktopApp }: AboutSectionProps) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsSection title={t("settings.about.title")}>
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.about.appVersion")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.about.thisDevice")}</Text>
            </View>
            <Text style={styles.aboutValue}>{appVersionText}</Text>
          </View>
        </View>
      </SettingsSection>
      {isDesktopApp ? <DesktopUpdatesSection appVersion={appVersion} /> : null}
      <ConnectedHostsSection clientVersion={appVersion} />
      <Attribution />
    </>
  );
}

function Attribution() {
  const isStockBrand = brand.legacyFrogg;
  const handleOpenUpstream = useCallback(() => {
    void openExternalUrl(isStockBrand ? PASEO_URL : FROGG_URL);
  }, [isStockBrand]);
  const components = useMemo(
    () => ({
      upstream: (
        <Text
          style={styles.attributionLink}
          accessibilityRole="link"
          onPress={handleOpenUpstream}
        />
      ),
    }),
    [handleOpenUpstream],
  );
  return (
    <Text style={styles.attribution} testID="settings-about-attribution">
      <Trans
        i18nKey={isStockBrand ? "settings.about.attributionUpstream" : "settings.about.attribution"}
        components={components}
      />
    </Text>
  );
}

function normalizeVersion(version: string | null | undefined): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^v/i, "");
}

function ConnectedHostsSection({ clientVersion }: { clientVersion: string | null }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  if (hosts.length === 0) {
    return null;
  }
  return (
    <SettingsSection title={t("settings.about.connectedHosts")}>
      <View style={settingsStyles.card}>
        {hosts.map((host, index) => (
          <HostVersionRow
            key={host.serverId}
            host={host}
            showBorder={index > 0}
            clientVersion={clientVersion}
          />
        ))}
      </View>
    </SettingsSection>
  );
}

function HostVersionRow({
  host,
  showBorder,
  clientVersion,
}: {
  host: HostProfile;
  showBorder: boolean;
  clientVersion: string | null;
}) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );

  const normalizedHost = normalizeVersion(daemonVersion);
  const normalizedClient = normalizeVersion(clientVersion);
  const isMismatch =
    normalizedHost !== null && normalizedClient !== null && normalizedHost !== normalizedClient;

  let valueText: string;
  if (!isConnected) {
    valueText = t("settings.about.offline");
  } else if (normalizedHost) {
    valueText = formatVersionWithPrefix(normalizedHost);
  } else {
    valueText = "—";
  }

  const valueStyle = useMemo(
    () => [styles.aboutValue, isMismatch && styles.aboutVersionMismatch],
    [isMismatch],
  );

  const handleUpdate = useCallback(() => openHostOverview(host.serverId), [host.serverId]);

  // A host on another version is the one place someone notices the daemon is behind, so the
  // row offers the way out. The update itself stays on the host page: it has the channel,
  // the progress and the reconnect wait, none of which belong in a one-line About row.
  const showUpdate = isConnected && isMismatch;

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {host.label}
        </Text>
        {isMismatch ? (
          <Text style={settingsStyles.rowHint}>{t("settings.about.versionDiffers")}</Text>
        ) : null}
      </View>
      <View style={styles.hostTrailing}>
        <Text style={valueStyle}>{valueText}</Text>
        {showUpdate ? (
          <Button
            variant="outline"
            size="sm"
            onPress={handleUpdate}
            testID={`settings-about-host-update-${host.serverId}`}
          >
            {t("settings.about.updateHost")}
          </Button>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  aboutValue: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  hostTrailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  aboutVersionMismatch: {
    color: theme.colors.palette.amber[500],
  },
  attribution: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
  },
  attributionLink: {
    color: theme.colors.foreground,
    textDecorationLine: "underline",
  },
}));
