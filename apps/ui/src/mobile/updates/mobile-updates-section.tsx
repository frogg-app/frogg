// Settings > Updates on Android: the installed version, the release channel,
// automatic checks, a manual check, and the published APK with its notes and a
// Download & install button that hands the file to the system installer.

import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Download, RefreshCw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { formatBytes } from "@/desktop/daemon/local-daemon-install-progress";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { useSettings, type Settings } from "@/hooks/use-settings";
import type { MobileUpdateProgress } from "@/mobile/updates/mobile-app-updater";
import {
  RELEASES_PAGE_URL,
  type MobileAppUpdateCheckResult,
} from "@/mobile/updates/mobile-updates";
import { useMobileAppUpdater } from "@/mobile/updates/use-mobile-app-updater";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";
import { formatMessageTimestamp } from "@/utils/time";

const ThemedDownload = withUnistyles(Download, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.accentForeground,
}));
const ThemedRefresh = withUnistyles(RefreshCw, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foreground,
}));

function ProgressBar({ progress }: { progress: MobileUpdateProgress }) {
  const fraction =
    progress.total && progress.total > 0 ? Math.min(1, progress.received / progress.total) : null;
  const fillStyle = useMemo(
    () => [styles.progressFill, { width: `${Math.round((fraction ?? 0.35) * 100)}%` as const }],
    [fraction],
  );
  return (
    <View style={styles.progressTrack} accessibilityRole="progressbar">
      <View style={fillStyle} />
    </View>
  );
}

function AvailableUpdateCard({
  update,
  progress,
  isBusy,
  onInstall,
}: {
  update: MobileAppUpdateCheckResult;
  progress: MobileUpdateProgress | null;
  isBusy: boolean;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  const downloadIcon = useMemo(() => <ThemedDownload />, []);
  const openRelease = useCallback(() => {
    void openExternalUrl(update.releaseUrl ?? RELEASES_PAGE_URL);
  }, [update.releaseUrl]);

  let hint = t("mobile.updates.section.noAsset");
  if (update.signatureMismatch) {
    hint = t("mobile.updates.section.signatureMismatch");
  } else if (update.asset) {
    hint = t("mobile.updates.section.installHint", {
      size: formatBytes(update.asset.size),
      abi: update.asset.abi,
    });
  }

  return (
    <View style={[settingsStyles.card, styles.availableCard]} testID="mobile-update-available">
      {/* Stacked, not a settings row: two buttons beside the text squeeze it to
          one character per line at phone widths. */}
      <View style={styles.availableHeader}>
        <View>
          <Text style={settingsStyles.rowTitle}>
            {t("mobile.updates.section.available", {
              version: formatVersionWithPrefix(update.latestVersion),
            })}
          </Text>
          <Text style={settingsStyles.rowHint}>{hint}</Text>
        </View>
        <View style={styles.actionGroup}>
          {update.releaseUrl || RELEASES_PAGE_URL ? (
            <Button variant="outline" size="sm" onPress={openRelease}>
              {t("mobile.updates.section.viewOnGithub")}
            </Button>
          ) : null}
          {update.asset ? (
            <Button
              size="sm"
              leftIcon={downloadIcon}
              onPress={onInstall}
              disabled={isBusy}
              loading={isBusy}
              testID="mobile-update-install"
            >
              {isBusy
                ? t("mobile.updates.section.installing")
                : t("mobile.updates.section.downloadAndInstall")}
            </Button>
          ) : null}
        </View>
      </View>
      {progress ? (
        <View style={styles.progressRow}>
          <ProgressBar progress={progress} />
          <Text style={styles.progressText}>
            {t("mobile.updates.section.downloading", {
              progress: progress.total
                ? `${formatBytes(progress.received)} / ${formatBytes(progress.total)}`
                : formatBytes(progress.received),
            })}
          </Text>
        </View>
      ) : null}
      {update.notes ? (
        <View style={styles.notes} testID="mobile-update-notes">
          <Text style={styles.notesTitle}>{t("mobile.updates.section.releaseNotes")}</Text>
          <MarkdownRenderer text={update.notes} compact />
        </View>
      ) : null}
    </View>
  );
}

export function MobileUpdatesSection({ appVersion }: { appVersion: string | null }) {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const {
    isSupported,
    status,
    statusText,
    availableUpdate,
    errorMessage,
    noticeMessage,
    lastCheckedAt,
    progress,
    isChecking,
    isBusy,
    checkForUpdates,
    downloadAndInstall,
  } = useMobileAppUpdater();

  const refreshIcon = useMemo(() => <ThemedRefresh />, []);
  const channelOptions = useMemo(
    () => [
      { value: "stable" as const, label: t("settings.about.releaseChannel.stable") },
      { value: "beta" as const, label: t("settings.about.releaseChannel.beta") },
    ],
    [t],
  );
  const handleChannelChange = useCallback(
    (mobileUpdateChannel: Settings["mobileUpdateChannel"]) => {
      void updateSettings({ mobileUpdateChannel });
    },
    [updateSettings],
  );
  const toggleAutoCheck = useCallback(() => {
    void updateSettings({ mobileUpdateAutoCheck: !settings.mobileUpdateAutoCheck });
  }, [settings.mobileUpdateAutoCheck, updateSettings]);
  const handleCheck = useCallback(() => {
    void checkForUpdates();
  }, [checkForUpdates]);
  const handleInstall = useCallback(() => {
    void downloadAndInstall();
  }, [downloadAndInstall]);

  if (!isSupported) {
    return null;
  }

  const lastCheckedText =
    lastCheckedAt == null
      ? t("mobile.updates.section.neverChecked")
      : t("mobile.updates.section.lastChecked", {
          time: formatMessageTimestamp(new Date(lastCheckedAt)),
        });

  return (
    <SettingsSection title={t("mobile.updates.section.title")} testID="mobile-updates-section">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("mobile.updates.section.currentVersion")}
            </Text>
            <Text style={settingsStyles.rowHint}>{t("mobile.updates.section.source")}</Text>
          </View>
          <Text style={styles.valueText} testID="mobile-updates-current-version">
            {formatVersionWithPrefix(appVersion)}
          </Text>
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.about.releaseChannel.label")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.about.releaseChannel.description")}
            </Text>
          </View>
          <SegmentedControl
            size="sm"
            value={settings.mobileUpdateChannel}
            onValueChange={handleChannelChange}
            options={channelOptions}
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("mobile.updates.section.autoCheck.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>{t("mobile.updates.section.autoCheck.hint")}</Text>
          </View>
          <Switch
            value={settings.mobileUpdateAutoCheck}
            onValueChange={toggleAutoCheck}
            accessibilityLabel={t("mobile.updates.section.autoCheck.title")}
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("mobile.updates.section.check")}</Text>
            <Text style={settingsStyles.rowHint}>{statusText}</Text>
            <Text style={settingsStyles.rowHint}>{lastCheckedText}</Text>
            {noticeMessage ? <Text style={styles.noticeText}>{noticeMessage}</Text> : null}
            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
            {status === "installed" ? (
              <Text style={styles.noticeText}>{t("mobile.updates.section.installedHint")}</Text>
            ) : null}
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={refreshIcon}
            onPress={handleCheck}
            disabled={isChecking || isBusy}
            testID="mobile-update-check"
          >
            {isChecking ? t("mobile.updates.section.checking") : t("mobile.updates.section.check")}
          </Button>
        </View>
      </View>
      {availableUpdate ? (
        <AvailableUpdateCard
          update={availableUpdate}
          progress={status === "downloading" ? progress : null}
          isBusy={isBusy}
          onInstall={handleInstall}
        />
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  valueText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  noticeText: {
    color: theme.colors.palette.amber[500],
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  availableHeader: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  actionGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  availableCard: {
    marginTop: theme.spacing[3],
  },
  progressRow: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  progressText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  notes: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  notesTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
  },
}));
