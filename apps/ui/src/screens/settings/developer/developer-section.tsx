import { useTranslation } from "react-i18next";
import { SettingsGroup } from "@/screens/settings/settings-group";
import { BetaAppCard } from "./beta-app-card";
import { HostDeveloperLinksSection } from "./host-developer-links";
import { StableAppCard, StableDaemonHostsSection } from "./stable-channel";

/**
 * Settings → Developer: shown only with About's "Developer options" switch on. One group per
 * channel — stable, beta, development — each with its app and its daemons.
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
        title={t("settings.developer.channels.beta.title")}
        info={t("settings.developer.channels.beta.info")}
        testID="developer-channel-beta"
      >
        <BetaAppCard />
        <HostDeveloperLinksSection testID="developer-beta-daemon-links" />
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
