import { useTranslation } from "react-i18next";
import { SettingsGroup } from "@/screens/settings/settings-group";
import { HostDeveloperLinksSection } from "./host-developer-links";
import { StableAppCard, StableDaemonHostsSection } from "./stable-channel";

/**
 * Settings → Developer: shown only with About's "Developer options" switch on. One group for the
 * released app and its daemons, one for development daemons run from source checkouts.
 */
export function DeveloperSection() {
  const { t } = useTranslation();
  return (
    <>
      <SettingsGroup
        title={t("settings.developer.channels.stable.title")}
        info={t("settings.developer.channels.stable.info")}
        testID="developer-channel-stable"
      >
        <StableAppCard />
        <StableDaemonHostsSection />
      </SettingsGroup>
      <SettingsGroup
        title={t("settings.developer.channels.development.title")}
        info={t("settings.developer.channels.development.info")}
        testID="developer-channel-development"
      >
        <HostDeveloperLinksSection testID="developer-dev-daemon-links" />
      </SettingsGroup>
    </>
  );
}
