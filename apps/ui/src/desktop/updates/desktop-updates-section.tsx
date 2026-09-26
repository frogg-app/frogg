import { brand } from "@frogg/branding";
// Settings > Updates for the desktop shell: current version and update
// strategy, release channel, automatic checks, "Check for updates" with the
// last-checked time. A found release takes over that row: Download & install
// enables once the background download lands, with its progress bar below.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Download, RefreshCw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { InstallProgressBar } from "@/desktop/components/local-daemon-bundle-card";
import type { LocalDaemonInstallProgress } from "@/desktop/daemon/local-daemon-install-progress";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import {
  appUpdateProgressFraction,
  describeAppUpdateProgress,
  describeInstallKind,
  type AppUpdateProgress,
} from "@/desktop/updates/app-update-progress";
import {
  formatVersionWithPrefix,
  getDesktopRuntimeInfo,
  type DesktopAppUpdateCheckResult,
  type DesktopUpdateStrategy,
} from "@/desktop/updates/desktop-updates";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import {
  releaseBuildFraction,
  type ReleaseBuildStatus,
} from "@/desktop/updates/release-build-status";
import { useReleaseBuildStatus } from "@/desktop/updates/use-release-build-status";
import { ReleaseChannelRow } from "@/release-channel/release-channel-row";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";
import { formatMessageTimestamp } from "@/utils/time";

const RELEASES_URL = brand.distribution.releaseBase;

const ThemedDownload = withUnistyles(Download, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.accentForeground,
}));
const ThemedRefresh = withUnistyles(RefreshCw, (theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foreground,
}));

/** The bar component is shared with the daemon bundle card; map our phases onto its shape. */
function toBarProgress(progress: AppUpdateProgress): LocalDaemonInstallProgress {
  const fraction = appUpdateProgressFraction(progress);
  if (progress.status !== "active" || fraction === null) {
    return {
      status: "installing",
      phase: "download",
      received: 0,
      total: null,
    };
  }
  return {
    status: "installing",
    phase: "download",
    received: progress.received,
    total: progress.total ?? progress.received,
  };
}

/** The CI bar reuses the daemon bundle bar; map step counts onto its shape. */
function toBuildBarProgress(status: ReleaseBuildStatus): LocalDaemonInstallProgress {
  const fraction = releaseBuildFraction(status);
  if (fraction === null) {
    return {
      status: "installing",
      phase: "download",
      received: 0,
      total: null,
    };
  }
  return {
    status: "installing",
    phase: "download",
    received: status.completedSteps,
    total: status.totalSteps,
  };
}

function describeReleaseBuild(
  status: ReleaseBuildStatus,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (status.state) {
    case "failed":
      return t("desktop.updates.section.build.failed", { job: status.jobName });
    case "succeeded":
      return t("desktop.updates.section.build.succeeded");
    case "queued":
      return t("desktop.updates.section.build.queued", { job: status.jobName });
    default:
      return t("desktop.updates.section.build.running", {
        job: status.jobName,
        completed: status.completedSteps,
        total: status.totalSteps,
        step: status.currentStep ?? t("desktop.updates.section.build.stepUnknown"),
      });
  }
}

function describeAvailability(
  update: DesktopAppUpdateCheckResult,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (update.readyToInstall) return describeInstallKind(update.installKind);
  if (update.downloading) return t("desktop.updates.section.downloadingInBackground");
  return t("desktop.updates.section.noAsset");
}

/** Progress of the CI job that builds this platform's download, while it runs. */
function ReleaseBuildProgress({ status }: { status: ReleaseBuildStatus }) {
  const { t } = useTranslation();
  const barProgress = useMemo(() => toBuildBarProgress(status), [status]);
  const openJob = useCallback(() => {
    if (status.url) void openExternalUrl(status.url);
  }, [status.url]);

  const detail = describeReleaseBuild(status, t);

  return (
    <View style={styles.progressRow} testID="desktop-update-build-progress">
      {status.state === "failed" ? null : <InstallProgressBar progress={barProgress} />}
      <Text style={status.state === "failed" ? styles.errorText : styles.progressText}>
        {detail}
      </Text>
      {status.url ? (
        <Button variant="ghost" size="sm" onPress={openJob} style={styles.buildLink}>
          {t("desktop.updates.section.build.viewJob")}
        </Button>
      ) : null}
    </View>
  );
}

function formatLastChecked(
  t: (key: string, options?: Record<string, unknown>) => string,
  lastCheckedAt: number | null,
  cachedCheckedAt: number | null | undefined,
): string {
  const timestamp = lastCheckedAt ?? cachedCheckedAt ?? null;
  if (timestamp == null) {
    return t("desktop.updates.section.neverChecked");
  }
  return t("desktop.updates.section.lastChecked", {
    time: formatMessageTimestamp(new Date(timestamp)),
  });
}

function useUpdateStrategy(): DesktopUpdateStrategy | null {
  const [strategy, setStrategy] = useState<DesktopUpdateStrategy | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDesktopRuntimeInfo()
      .then((info) => {
        if (!cancelled) setStrategy(info.updateStrategy);
        return;
      })
      .catch(() => {
        // The strategy line is informational; leave it out when unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return strategy;
}

function useAutoCheckToggle() {
  const { settings, updateSettings } = useDesktopSettings();
  const [isUpdating, setIsUpdating] = useState(false);
  const autoCheck = settings.updates.autoCheck;
  const toggle = useCallback(() => {
    setIsUpdating(true);
    void updateSettings({ updates: { autoCheck: !autoCheck } })
      .catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      })
      .finally(() => setIsUpdating(false));
  }, [autoCheck, updateSettings]);
  return { autoCheck, isUpdating, toggle };
}

/**
 * Everything under the "Check for updates" row once a release is found: the
 * download bar (background download or install), the CI build while this
 * platform's asset is still missing, and the release notes.
 */
function AvailableUpdateDetails({
  update,
  progress,
}: {
  update: DesktopAppUpdateCheckResult;
  progress: AppUpdateProgress;
}) {
  const { t } = useTranslation();
  const barProgress = useMemo(() => toBarProgress(progress), [progress]);
  // Only worth asking CI about while this platform's asset is still missing; a
  // download under way means it is published.
  const buildStatus = useReleaseBuildStatus(
    update.readyToInstall || update.downloading ? null : update.latestVersion,
  );
  const showBar = progress.status === "active" || (update.downloading && !update.readyToInstall);

  return (
    <>
      {showBar ? (
        <View style={styles.progressRow} testID="desktop-update-progress">
          <InstallProgressBar progress={barProgress} />
          {progress.status === "active" ? (
            <Text style={styles.progressText}>{describeAppUpdateProgress(progress)}</Text>
          ) : null}
        </View>
      ) : null}
      {!update.readyToInstall && !update.downloading && buildStatus ? (
        <ReleaseBuildProgress status={buildStatus} />
      ) : null}
      {update.notes ? (
        <View style={styles.notes} testID="desktop-update-notes">
          <Text style={styles.notesTitle}>{t("desktop.updates.section.releaseNotes")}</Text>
          <MarkdownRenderer text={update.notes} compact />
        </View>
      ) : null}
    </>
  );
}

interface UpdateCheckRowProps {
  available: DesktopAppUpdateCheckResult | null;
  statusText: string;
  lastCheckedText: string;
  showLastChecked: boolean;
  errorMessage: string | null;
  restartRequired: boolean;
  isChecking: boolean;
  isInstalling: boolean;
  onCheck: () => void;
  onInstall: () => void;
}

/** "Check for updates", or the found release with Download & install once it is downloaded. */
function UpdateCheckRow({
  available,
  statusText,
  lastCheckedText,
  showLastChecked,
  errorMessage,
  restartRequired,
  isChecking,
  isInstalling,
  onCheck,
  onInstall,
}: UpdateCheckRowProps) {
  const { t } = useTranslation();
  const refreshIcon = useMemo(() => <ThemedRefresh />, []);
  const downloadIcon = useMemo(() => <ThemedDownload />, []);
  const releaseUrl = available?.releaseUrl ?? RELEASES_URL;
  const openRelease = useCallback(() => {
    void openExternalUrl(releaseUrl);
  }, [releaseUrl]);

  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {available
            ? t("desktop.updates.section.available", {
                version: formatVersionWithPrefix(available.latestVersion),
              })
            : t("desktop.updates.section.check")}
        </Text>
        <Text style={settingsStyles.rowHint}>
          {available ? describeAvailability(available, t) : statusText}
        </Text>
        {showLastChecked ? <Text style={settingsStyles.rowHint}>{lastCheckedText}</Text> : null}
        {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}
        {restartRequired ? (
          <Text style={styles.noticeText}>{t("desktop.updates.section.restartRequired")}</Text>
        ) : null}
      </View>
      {available ? (
        <View style={styles.actionGroup}>
          <Button variant="outline" size="sm" onPress={openRelease}>
            {t("desktop.updates.section.viewOnGithub")}
          </Button>
          <Button
            size="sm"
            leftIcon={downloadIcon}
            onPress={onInstall}
            disabled={!available.readyToInstall || isInstalling}
            loading={isInstalling}
            testID="desktop-update-install"
          >
            {isInstalling
              ? t("desktop.updates.section.installing")
              : t("desktop.updates.section.downloadAndInstall")}
          </Button>
        </View>
      ) : (
        <Button
          variant="outline"
          size="sm"
          leftIcon={refreshIcon}
          onPress={onCheck}
          disabled={isChecking || isInstalling}
          testID="desktop-update-check"
        >
          {isChecking ? t("desktop.updates.section.checking") : t("desktop.updates.section.check")}
        </Button>
      )}
    </View>
  );
}

export function DesktopUpdatesSection({ appVersion }: { appVersion: string | null }) {
  const { t } = useTranslation();
  const strategy = useUpdateStrategy();
  const {
    autoCheck,
    isUpdating: isUpdatingAutoCheck,
    toggle: toggleAutoCheck,
  } = useAutoCheckToggle();
  const {
    isDesktopApp,
    status,
    statusText,
    availableUpdate,
    errorMessage,
    lastCheckedAt,
    isChecking,
    isInstalling,
    progress,
    checkForUpdates,
    installUpdate,
  } = useDesktopAppUpdater();

  const handleCheck = useCallback(() => {
    void checkForUpdates();
  }, [checkForUpdates]);

  const handleInstall = useCallback(() => {
    void installUpdate();
  }, [installUpdate]);

  if (!isDesktopApp) {
    return null;
  }

  if (brand.distribution.updateMode === "disabled" || strategy === "disabled") {
    return (
      <SettingsSection title={t("desktop.updates.section.title")} testID="desktop-updates-section">
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("desktop.updates.section.currentVersion")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("desktop.updates.section.strategyDisabled")}
              </Text>
            </View>
            <Text style={styles.valueText}>{formatVersionWithPrefix(appVersion)}</Text>
          </View>
        </View>
      </SettingsSection>
    );
  }

  const lastCheckedText = formatLastChecked(t, lastCheckedAt, availableUpdate?.checkedAt);
  const available =
    availableUpdate !== null && (status === "available" || status === "pending" || isInstalling)
      ? availableUpdate
      : null;

  return (
    <SettingsSection title={t("desktop.updates.section.title")} testID="desktop-updates-section">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("desktop.updates.section.currentVersion")}
            </Text>
            {strategy ? (
              <Text style={settingsStyles.rowHint}>
                {strategy === "tauri-signed"
                  ? t("desktop.updates.section.strategySigned")
                  : t("desktop.updates.section.strategyGithub")}
              </Text>
            ) : null}
          </View>
          <Text style={styles.valueText} testID="desktop-updates-current-version">
            {formatVersionWithPrefix(appVersion)}
          </Text>
        </View>
        <ReleaseChannelRow />
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("desktop.updates.section.autoCheck.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("desktop.updates.section.autoCheck.hint")}
            </Text>
          </View>
          <Switch
            value={autoCheck}
            onValueChange={toggleAutoCheck}
            disabled={isUpdatingAutoCheck}
            accessibilityLabel={t("desktop.updates.section.autoCheck.title")}
          />
        </View>
        <UpdateCheckRow
          available={available}
          statusText={statusText}
          lastCheckedText={lastCheckedText}
          showLastChecked={available !== null || lastCheckedAt === null}
          errorMessage={errorMessage}
          restartRequired={status === "installed"}
          isChecking={isChecking}
          isInstalling={isInstalling}
          onCheck={handleCheck}
          onInstall={handleInstall}
        />
        {available ? <AvailableUpdateDetails update={available} progress={progress} /> : null}
      </View>
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
  actionGroup: {
    flexDirection: "row",
    gap: theme.spacing[2],
    flexWrap: "wrap",
    justifyContent: "flex-end",
    // Holds the buttons against the right edge once the row has wrapped them onto their own line.
    marginLeft: "auto",
  },
  progressRow: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
    gap: theme.spacing[2],
  },
  progressText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  buildLink: {
    alignSelf: "flex-start",
    paddingHorizontal: 0,
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
