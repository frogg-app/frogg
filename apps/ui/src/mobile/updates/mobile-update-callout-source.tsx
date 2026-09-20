// Tells the user an Android update is waiting without them having to open
// Settings; the actions run the same download-and-install as the section.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { withUnistyles } from "react-native-unistyles";
import { Gift } from "lucide-react-native";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { useStableEvent } from "@/hooks/use-stable-event";
import { RELEASES_PAGE_URL } from "@/mobile/updates/mobile-updates";
import { useMobileAppUpdater } from "@/mobile/updates/use-mobile-app-updater";
import { openExternalUrl } from "@/utils/open-external-url";

const CALLOUT_PRIORITY = 200;

const ThemedGift = withUnistyles(Gift, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
}));

export function MobileUpdateCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const { isSupported, status, availableUpdate, isBusy, downloadAndInstall } =
    useMobileAppUpdater();

  const install = useStableEvent(() => {
    void downloadAndInstall();
  });
  const openRelease = useStableEvent(() => {
    void openExternalUrl(availableUpdate?.releaseUrl ?? RELEASES_PAGE_URL);
  });

  const version = availableUpdate?.latestVersion ?? null;
  const hasAsset = availableUpdate?.asset != null;
  const isOffered = status === "available" || status === "downloading" || status === "installing";

  useEffect(() => {
    if (!isSupported || !isOffered || !version || !hasAsset) return;

    return callouts.show({
      id: "mobile-update",
      dismissalKey: `mobile-update:${version}`,
      priority: CALLOUT_PRIORITY,
      title: t("mobile.updates.callout.title"),
      description: t("mobile.updates.callout.description", {
        version: formatVersionWithPrefix(version),
      }),
      icon: <ThemedGift />,
      actions: [
        { label: t("mobile.updates.callout.whatsNew"), onPress: openRelease },
        {
          label: isBusy
            ? t("mobile.updates.callout.installing")
            : t("mobile.updates.callout.install"),
          onPress: install,
          variant: "primary",
          disabled: isBusy,
          testID: "mobile-update-callout-install",
        },
      ],
      testID: "mobile-update-callout",
    });
  }, [callouts, hasAsset, install, isBusy, isOffered, isSupported, openRelease, t, version]);

  return null;
}
