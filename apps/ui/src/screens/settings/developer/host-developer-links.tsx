import { useCallback, useMemo } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { useHosts } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";

/** Each host, linking to its Developer tab, where its beta and development daemons are run. */
export function HostDeveloperLinksSection({ testID }: { testID: string }) {
  const { t } = useTranslation();
  const hosts = useHosts();
  return (
    <SettingsSection
      title={t("settings.developer.sections.daemons")}
      info={t("settings.developer.manageOnHost")}
      testID={testID}
    >
      <View style={settingsStyles.card}>
        {hosts.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("settings.developer.betaDaemon.noHosts")}</Text>
          </View>
        ) : (
          hosts.map((host, index) => (
            <HostDeveloperLink
              key={host.serverId}
              host={host}
              showBorder={index > 0}
              testID={`${testID}-${host.serverId}`}
            />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function HostDeveloperLink({
  host,
  showBorder,
  testID,
}: {
  host: HostProfile;
  showBorder: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const handleOpen = useCallback(() => {
    router.push(buildSettingsHostSectionRoute(host.serverId, "developer"));
  }, [host.serverId, router]);
  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {host.label}
        </Text>
      </View>
      <Button variant="outline" size="sm" onPress={handleOpen} testID={testID}>
        {t("settings.developer.manage")}
      </Button>
    </View>
  );
}
