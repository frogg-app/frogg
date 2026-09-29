import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { brand } from "@frogg/branding";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getDesktopHost,
  type DesktopBetaAppBridge,
  type DesktopBetaAppInstallProgress,
  type DesktopBetaAppLatestRelease,
  type DesktopBetaAppStatus,
} from "@/desktop/host";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  betaAppDownloadFraction,
  formatMegabytes,
  isBetaAppInstallActive,
  resolveBetaAppAction,
} from "./beta-app-state";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type LatestState =
  | { kind: "loading" }
  | { kind: "loaded"; release: DesktopBetaAppLatestRelease }
  | { kind: "error"; message: string };

/**
 * The beta desktop app card. Desktop builds with the `betaApp` bridge install it in place;
 * web and mobile link to the releases page, since there is nothing to install beside them.
 */
export function BetaAppCard() {
  const bridge = getDesktopHost()?.betaApp ?? null;
  if (bridge) return <DesktopBetaAppCard bridge={bridge} />;
  return <BetaAppReleasesLink />;
}

function BetaAppReleasesLink() {
  const { t } = useTranslation();
  const releaseBase = brand.distribution.releaseBase;
  const handleOpen = useCallback(() => {
    if (releaseBase) void openExternalUrl(releaseBase);
  }, [releaseBase]);
  if (!releaseBase) return null;
  return (
    <SettingsSection title={t("settings.developer.betaApp.title")} testID="developer-beta-app">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.developer.betaApp.title")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.developer.betaApp.webHint")}</Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpen}
            testID="developer-beta-app-releases"
          >
            {t("settings.developer.betaApp.openReleases")}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

function DesktopBetaAppCard({ bridge }: { bridge: DesktopBetaAppBridge }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DesktopBetaAppStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [latest, setLatest] = useState<LatestState>({ kind: "loading" });
  const [progress, setProgress] = useState<DesktopBetaAppInstallProgress | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await bridge.getStatus();
      if (!mounted.current) return;
      setStatus(next);
      setStatusError(null);
    } catch (error) {
      if (mounted.current) setStatusError(errorText(error));
    }
  }, [bridge]);

  const refreshLatest = useCallback(async () => {
    setLatest({ kind: "loading" });
    try {
      const release = await bridge.resolveLatest();
      if (mounted.current) setLatest({ kind: "loaded", release });
    } catch (error) {
      if (mounted.current) setLatest({ kind: "error", message: errorText(error) });
    }
  }, [bridge]);

  useEffect(() => {
    void refreshStatus().then(() => refreshLatest());
  }, [refreshLatest, refreshStatus]);

  // Progress is broadcast to every window, so an install started in another window shows too.
  useEffect(
    () =>
      bridge.onProgress((next) => {
        if (!mounted.current) return;
        setProgress(next);
        if (next.phase === "launched" || next.phase === "failed" || next.phase === "cancelled") {
          void refreshStatus();
        }
      }),
    [bridge, refreshStatus],
  );

  const release = latest.kind === "loaded" ? latest.release : null;
  const action = resolveBetaAppAction(status, release);
  const installing = isBetaAppInstallActive(progress) || status?.installing === true;

  const handleInstall = useCallback(async () => {
    setActionError(null);
    setProgress({
      phase: "resolving",
      version: null,
      assetName: null,
      receivedBytes: 0,
      totalBytes: null,
      error: null,
    });
    try {
      await bridge.install();
    } catch (error) {
      if (!mounted.current) return;
      // A cancel rejects the install too; the cancelled phase already says so.
      setProgress((current) => (current?.phase === "cancelled" ? current : null));
      setActionError((current) => current ?? errorText(error));
    } finally {
      if (mounted.current) void refreshStatus();
    }
  }, [bridge, refreshStatus]);

  const handleCancel = useCallback(async () => {
    try {
      await bridge.cancelInstall();
    } catch (error) {
      if (mounted.current) setActionError(errorText(error));
    }
  }, [bridge]);

  const handleOpen = useCallback(async () => {
    setActionError(null);
    setOpening(true);
    try {
      await bridge.open();
    } catch (error) {
      if (mounted.current) {
        setActionError(t("settings.developer.betaApp.openFailed", { error: errorText(error) }));
      }
    } finally {
      if (mounted.current) setOpening(false);
    }
  }, [bridge, t]);

  const betaName = status?.betaName ?? t("settings.developer.betaApp.title");

  return (
    <SettingsSection
      title={t("settings.developer.betaApp.title")}
      info={t("settings.developer.betaApp.info", { name: betaName })}
      testID="developer-beta-app"
    >
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{betaName}</Text>
            <Text style={settingsStyles.rowHint} testID="developer-beta-app-installed">
              {installedText(status, statusError, t)}
            </Text>
          </View>
          {status?.installed ? (
            <Button
              variant="outline"
              size="sm"
              onPress={handleOpen}
              loading={opening}
              disabled={installing}
              testID="developer-beta-app-open"
            >
              {t("settings.developer.betaApp.open")}
            </Button>
          ) : null}
        </View>
        {status?.supported !== false ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.developer.betaApp.latest")}</Text>
              <Text style={settingsStyles.rowHint} testID="developer-beta-app-latest">
                {latestText(latest, t)}
              </Text>
            </View>
            {installing ? (
              <Button
                variant="outline"
                size="sm"
                onPress={handleCancel}
                testID="developer-beta-app-cancel"
              >
                {t("settings.developer.cancel")}
              </Button>
            ) : (
              <PrimaryButton
                action={action}
                latestFailed={latest.kind === "error"}
                onInstall={handleInstall}
                onRetry={refreshLatest}
              />
            )}
          </View>
        ) : null}
        {progress ? <InstallProgress progress={progress} /> : null}
        {actionError ? (
          <View style={styles.alert}>
            <InlineAlert variant="error" description={actionError} />
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

function installedText(
  status: DesktopBetaAppStatus | null,
  error: string | null,
  t: TFunction,
): string {
  if (error) return t("settings.developer.betaApp.statusFailed", { error });
  if (!status) return t("settings.developer.loading");
  if (!status.supported && status.unsupportedReason) {
    return t(`settings.developer.betaApp.unsupported.${status.unsupportedReason}`);
  }
  if (!status.installed) return t("settings.developer.betaApp.notInstalled");
  return status.installedVersion
    ? t("settings.developer.betaApp.installedVersion", { version: status.installedVersion })
    : t("settings.developer.betaApp.installed");
}

function latestText(latest: LatestState, t: TFunction): string {
  if (latest.kind === "loading") return t("settings.developer.loading");
  if (latest.kind === "error") {
    return t("settings.developer.betaApp.latestFailed", { error: latest.message });
  }
  return latest.release.version;
}

function PrimaryButton({
  action,
  latestFailed,
  onInstall,
  onRetry,
}: {
  action: ReturnType<typeof resolveBetaAppAction>;
  latestFailed: boolean;
  onInstall: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (latestFailed) {
    return (
      <Button variant="outline" size="sm" onPress={onRetry} testID="developer-beta-app-retry">
        {t("settings.developer.retry")}
      </Button>
    );
  }
  if (action.kind === "upToDate") {
    return <Text style={settingsStyles.rowHint}>{t("settings.developer.upToDate")}</Text>;
  }
  if (action.kind === "none") return null;
  return (
    <Button variant="default" size="sm" onPress={onInstall} testID="developer-beta-app-install">
      {action.kind === "install"
        ? t("settings.developer.installVersion", { version: action.version })
        : t("settings.developer.updateVersion", { version: action.version })}
    </Button>
  );
}

function InstallProgress({ progress }: { progress: DesktopBetaAppInstallProgress }) {
  const { t } = useTranslation();
  const fraction = betaAppDownloadFraction(progress);
  const active = isBetaAppInstallActive(progress);
  const accessibilityValue = useMemo(
    () => (fraction === null ? undefined : { min: 0, max: 100, now: Math.round(fraction * 100) }),
    [fraction],
  );
  const fillStyle = useMemo(
    () => [styles.progressFill, { width: `${Math.round((fraction ?? 0.15) * 100)}%` as const }],
    [fraction],
  );
  let detail: string | null = null;
  if (progress.phase === "downloading") {
    detail =
      progress.totalBytes !== null
        ? t("settings.developer.betaApp.downloaded", {
            received: formatMegabytes(progress.receivedBytes),
            total: formatMegabytes(progress.totalBytes),
          })
        : formatMegabytes(progress.receivedBytes);
  }
  const label =
    progress.phase === "failed" && progress.error
      ? t("settings.developer.betaApp.failed", { error: progress.error })
      : t(`settings.developer.betaApp.phases.${progress.phase}`, {
          version: progress.version ?? "",
        });
  return (
    <View style={styles.progressBlock} testID="developer-beta-app-progress">
      <Text style={progress.phase === "failed" ? settingsStyles.rowError : styles.progressLabel}>
        {label}
      </Text>
      {active ? (
        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityValue={accessibilityValue}
        >
          <View style={fillStyle} />
        </View>
      ) : null}
      {detail ? <Text style={styles.progressHint}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  alert: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  progressBlock: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  progressLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  progressHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
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
}));
