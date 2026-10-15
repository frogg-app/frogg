import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useHosts } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { DevDaemonHostRow } from "./dev-daemon-hosts";

/**
 * Host → Developer: launch or stop a development daemon from one of this host's source
 * checkouts. Shown with the app's Developer options on.
 */
export function HostDeveloperPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHosts().find((candidate) => candidate.serverId === serverId);
  if (!host) return null;
  return (
    <View>
      <SettingsSection
        title={t("settings.developer.sections.devDaemon")}
        info={t("settings.developer.devDaemon.info")}
        testID="host-developer-dev"
      >
        <View style={settingsStyles.card}>
          <DevDaemonHostRow host={host} showBorder={false} showLabel={false} />
        </View>
      </SettingsSection>
    </View>
  );
}
