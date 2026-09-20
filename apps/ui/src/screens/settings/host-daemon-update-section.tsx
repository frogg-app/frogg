import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type {
  DaemonUpdateChannel,
  DaemonUpdateGetStatusResponse,
  DaemonUpdateRun,
} from "@frogg/protocol/messages";
import { Alert as InlineAlert, type AlertVariant } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
} from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import type { HostProfile } from "@/types/host-connection";
import { hasDaemonReconnectedAfter, type DaemonConnectionMarker } from "./daemon-reconnect";
import {
  describeRunButton,
  describeRunState,
  downloadFraction,
  formatDuration,
} from "./daemon-update-progress";
import { effectiveLastUpdateResult } from "./daemon-update-outcome";
import { useDaemonUpdateCheck, type CheckState, type RunState } from "./host-daemon-update-state";

/**
 * Daemon self-update for any host whose daemon is a versioned install:
 * check the release channel, update with progress, and show the supervisor's
 * outcome (applied or rolled back) once the daemon is back. Also the opt-in
 * auto-update toggle and channel, stored in the daemon's config.json.
 */
type StatusPayload = DaemonUpdateGetStatusResponse["payload"];

const RECONNECT_TIMEOUT_MS = 4 * 60_000;
const RECONNECT_POLL_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outcomeVariant(status: "applied" | "rolled_back" | "failed"): AlertVariant {
  if (status === "applied") return "success";
  if (status === "rolled_back") return "warning";
  return "error";
}

function availableVersion(check: CheckState): string | null {
  if (check.kind !== "checked" || !check.result.updateAvailable) return null;
  return check.result.latestVersion;
}

function versionHint(status: StatusPayload | null, check: CheckState, t: TFunction): string {
  if (!(status?.updatable ?? false)) {
    return status?.reason ?? t("settings.host.daemon.selfUpdate.notUpdatable");
  }
  if (check.kind === "checking") return t("settings.host.daemon.selfUpdate.checking");
  if (check.kind === "error") {
    return t("settings.host.daemon.selfUpdate.checkFailed", { error: check.message });
  }
  if (check.kind === "checked") {
    if (check.result.error) {
      return t("settings.host.daemon.selfUpdate.checkFailed", { error: check.result.error });
    }
    const available = availableVersion(check);
    // Updating no longer asks for confirmation, so what the update does to running
    // agents has to be readable before the button is pressed, not after.
    return available
      ? [
          t("settings.host.daemon.selfUpdate.available", { version: available }),
          t("settings.host.daemon.selfUpdate.updateNote"),
        ].join("\n")
      : t("settings.host.daemon.selfUpdate.upToDate");
  }
  return t("settings.host.daemon.selfUpdate.hint");
}

const ThemedSpinner = withUnistyles(LoadingSpinner);
const spinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Determinate while the download reports bytes, indeterminate otherwise. */
function ProgressBar({ fraction }: { fraction: number | null }) {
  const width = `${Math.round((fraction ?? 0.35) * 100)}%` as const;
  const accessibilityValue = useMemo(
    () => (fraction === null ? undefined : { now: Math.round(fraction * 100), min: 0, max: 100 }),
    [fraction],
  );
  return (
    <View
      style={styles.progressTrack}
      accessibilityRole="progressbar"
      accessibilityValue={accessibilityValue}
      testID="host-page-daemon-update-progress-bar"
    >
      <View style={[styles.progressFill, { width }]} />
    </View>
  );
}

/**
 * The live row for a run in flight: what phase it is in, how much has
 * downloaded, and — once the daemon is restarting — a spinner with how long
 * the app will keep waiting for it to check back in.
 */
function RunProgress({
  run,
  remainingMs,
  showProgressBar,
}: {
  run: RunState;
  remainingMs: number | null;
  /** Only daemons that report byte counts get a bar; older ones keep the text-only phase line. */
  showProgressBar: boolean;
}) {
  const { t } = useTranslation();
  if (run.kind === "idle" || run.kind === "error") return null;
  const label = describeRunState(run, t);
  const running = run.kind === "running" ? run.run : null;
  const fraction = downloadFraction(running);
  const waiting = run.kind === "reconnecting";
  const installing =
    running !== null && (running.phase === "install" || running.phase === "restart");
  return (
    <View style={styles.runBlock} testID="host-page-daemon-update-progress">
      <View style={styles.runHeader}>
        {waiting ? <ThemedSpinner size="small" uniProps={spinnerMapping} /> : null}
        <Text style={styles.runLabel} testID="host-page-daemon-update-phase">
          {label}
        </Text>
      </View>
      {waiting || !showProgressBar ? null : <ProgressBar fraction={fraction} />}
      {installing ? (
        <Text style={styles.runHint}>{t("settings.host.daemon.selfUpdate.installingNote")}</Text>
      ) : null}
      {waiting && remainingMs !== null ? (
        <Text style={styles.runHint} testID="host-page-daemon-update-countdown">
          {t("settings.host.daemon.selfUpdate.reconnectCountdown", {
            remaining: formatDuration(remainingMs),
          })}
        </Text>
      ) : null}
    </View>
  );
}

function RunAlerts({ run, status }: { run: RunState; status: StatusPayload | null }) {
  const { t } = useTranslation();
  const lastResult = effectiveLastUpdateResult(status);
  return (
    <>
      {run.kind === "error" ? (
        <View style={styles.alert}>
          <InlineAlert
            variant="error"
            title={t("settings.host.daemon.selfUpdate.startFailedTitle")}
            description={run.message}
            testID="host-page-daemon-update-error"
          />
        </View>
      ) : null}
      {lastResult ? (
        <View style={styles.alert}>
          <InlineAlert
            variant={outcomeVariant(lastResult.status)}
            title={t(`settings.host.daemon.selfUpdate.outcome.${lastResult.status}`, {
              from: lastResult.from ?? "?",
              to: lastResult.to,
            })}
            description={[
              lastResult.reason,
              t("settings.host.daemon.selfUpdate.logHint", {
                installDir: status?.installDir ?? "",
              }),
            ]
              .filter(Boolean)
              .join(" ")}
            testID="host-page-daemon-update-outcome"
          />
        </View>
      ) : null}
    </>
  );
}

function VersionRow({
  status,
  check,
  runLabel,
  busy,
  isConnected,
  onCheck,
  onUpdate,
}: {
  status: StatusPayload | null;
  check: CheckState;
  runLabel: string | null;
  busy: boolean;
  isConnected: boolean;
  onCheck: () => void;
  onUpdate: (version: string) => void;
}) {
  const { t } = useTranslation();
  const updatable = status?.updatable ?? false;
  const available = availableVersion(check);
  const handleUpdate = useCallback(() => {
    if (available) onUpdate(available);
  }, [available, onUpdate]);
  const hint = versionHint(status, check, t);

  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>
          {status?.currentVersion
            ? t("settings.host.daemon.selfUpdate.versionLabel", { version: status.currentVersion })
            : t("settings.host.daemon.selfUpdate.versionUnknown")}
        </Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      {updatable && !available ? (
        <Button
          variant="outline"
          size="sm"
          onPress={onCheck}
          disabled={!isConnected || busy || check.kind === "checking"}
          testID="host-page-daemon-update-check"
        >
          {t("settings.host.daemon.selfUpdate.check")}
        </Button>
      ) : null}
      {updatable && available ? (
        <Button
          variant="default"
          size="sm"
          onPress={handleUpdate}
          disabled={!isConnected || busy}
          testID="host-page-daemon-update-start"
        >
          {runLabel ?? t("settings.host.daemon.selfUpdate.update", { version: available })}
        </Button>
      ) : null}
    </View>
  );
}

function AutoUpdateRows({
  enabled,
  channel,
  disabled,
  onPatch,
}: {
  enabled: boolean;
  channel: DaemonUpdateChannel;
  disabled: boolean;
  onPatch: (patch: { enabled?: boolean; channel?: DaemonUpdateChannel }) => void;
}) {
  const { t } = useTranslation();
  const handleToggle = useCallback((next: boolean) => onPatch({ enabled: next }), [onPatch]);
  const chooseStable = useCallback(() => onPatch({ channel: "stable" }), [onPatch]);
  const chooseBeta = useCallback(() => onPatch({ channel: "beta" }), [onPatch]);
  return (
    <>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.daemon.selfUpdate.autoUpdate.title")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.daemon.selfUpdate.autoUpdate.hint")}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          disabled={disabled}
          accessibilityLabel={t("settings.host.daemon.selfUpdate.autoUpdate.title")}
          testID="host-page-daemon-auto-update-switch"
        />
      </View>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.daemon.selfUpdate.autoUpdate.channelLabel")}
          </Text>
        </View>
        <View style={styles.channelRow}>
          <Button
            variant={channel === "stable" ? "default" : "outline"}
            size="sm"
            onPress={chooseStable}
            disabled={disabled}
            testID="host-page-daemon-update-channel-stable"
          >
            {t("settings.host.daemon.selfUpdate.autoUpdate.stable")}
          </Button>
          <Button
            variant={channel === "beta" ? "default" : "outline"}
            size="sm"
            onPress={chooseBeta}
            disabled={disabled}
            testID="host-page-daemon-update-channel-beta"
          >
            {t("settings.host.daemon.selfUpdate.autoUpdate.beta")}
          </Button>
        </View>
      </View>
    </>
  );
}

export function HostDaemonUpdateSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const { config, patchConfig } = useDaemonConfig(host.serverId);
  const supported = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.daemonUpdateRuns === true,
  );
  // COMPAT(daemonUpdateProgressBytes): older daemons send no byte counts, so they
  // degrade to the phase label alone.
  const supportsProgressBytes = useSessionStore(
    (state) =>
      state.sessions[host.serverId]?.serverInfo?.features?.daemonUpdateProgressBytes === true,
  );
  const desktopManaged = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.desktopManaged === true,
  );
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [run, setRun] = useState<RunState>({ kind: "idle" });

  // One ticker for the whole wait, so the countdown the user reads matches the
  // deadline the wait loop enforces.
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  useEffect(() => {
    if (run.kind !== "reconnecting") {
      setRemainingMs(null);
      return;
    }
    const { deadline } = run;
    const tick = () => setRemainingMs(Math.max(0, deadline - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [run]);

  const mounted = useRef(true);
  const channel: DaemonUpdateChannel = config?.autoUpdate?.channel ?? "stable";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    if (!daemonClient || !supported) return null;
    try {
      const next = await daemonClient.getDaemonUpdateStatus();
      if (mounted.current) setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, [daemonClient, supported]);

  useEffect(() => {
    if (!isConnected) return;
    void refreshStatus();
  }, [isConnected, refreshStatus]);

  const { check, runCheck, resetCheck } = useDaemonUpdateCheck(daemonClient, channel, mounted);

  // Progress is broadcast to every session, so a run started elsewhere shows too.
  useEffect(() => {
    if (!daemonClient || !supported) return;
    return daemonClient.on("daemon.update.run.progress", (message) => {
      if (!mounted.current) return;
      const progress = message.payload;
      if (progress.phase === "failed") {
        setRun({
          kind: "error",
          message: progress.message ?? t("settings.host.daemon.selfUpdate.phases.failed"),
        });
        void refreshStatus();
        return;
      }
      setRun((current) =>
        current.kind === "reconnecting" ? current : { kind: "running", run: progress },
      );
    });
  }, [daemonClient, refreshStatus, supported, t]);

  const waitForOutcome = useCallback(
    async (marker: DaemonConnectionMarker | null, activeRun: DaemonUpdateRun) => {
      const deadline = Date.now() + RECONNECT_TIMEOUT_MS;
      setRun({ kind: "reconnecting", run: activeRun, deadline });
      const runtime = getHostRuntimeStore();
      while (Date.now() < deadline && mounted.current) {
        if (hasDaemonReconnectedAfter(runtime.getSnapshot(host.serverId), marker)) {
          const next = await refreshStatus();
          if (next?.lastResult && next.lastResult.at > activeRun.at) {
            setRun({ kind: "idle" });
            resetCheck();
            return;
          }
        }
        await delay(RECONNECT_POLL_MS);
      }
      if (mounted.current) {
        setRun({
          kind: "error",
          message: t("settings.host.daemon.selfUpdate.unableToReconnect", {
            name: host.label,
            timeout: formatDuration(RECONNECT_TIMEOUT_MS),
          }),
        });
      }
    },
    [host.label, host.serverId, refreshStatus, resetCheck, t],
  );

  useEffect(() => {
    if (run.kind !== "running" || run.run.phase !== "restart") return;
    const snapshot = getHostRuntimeStore().getSnapshot(host.serverId);
    const marker = snapshot
      ? { clientGeneration: snapshot.clientGeneration, lastOnlineAt: snapshot.lastOnlineAt }
      : null;
    void waitForOutcome(marker, run.run);
  }, [host.serverId, run, waitForOutcome]);

  const handleUpdate = useCallback(
    async (version: string) => {
      if (!daemonClient) return;
      // No confirmation: the button already names the version, nothing is lost, and a
      // version that fails to start is rolled back automatically. The interruption
      // warning lives on the row instead.
      if (!mounted.current) return;
      setRun({ kind: "starting" });
      try {
        const started = await daemonClient.startDaemonUpdate({ version, channel });
        if (!started.accepted) {
          setRun({
            kind: "error",
            message: started.error ?? t("settings.host.daemon.selfUpdate.phases.failed"),
          });
        }
      } catch (error) {
        setRun({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    },
    [channel, daemonClient, t],
  );

  const handleAutoUpdatePatch = useCallback(
    (patch: { enabled?: boolean; channel?: DaemonUpdateChannel }) => {
      void patchConfig({ autoUpdate: patch }).catch((error) => {
        console.error("[HostDaemonUpdateSection] Failed to save auto-update settings", error);
      });
    },
    [patchConfig],
  );

  if (!supported || desktopManaged) return null;

  const busy = run.kind !== "idle" && run.kind !== "error";
  const runLabel = describeRunButton(run, t);

  return (
    <SettingsSection
      title={t("settings.host.daemon.selfUpdate.title")}
      info={t("settings.host.daemon.selfUpdate.info")}
      testID="host-page-daemon-update"
    >
      <View style={settingsStyles.card}>
        <VersionRow
          status={status}
          check={check}
          runLabel={runLabel}
          busy={busy}
          isConnected={isConnected}
          onCheck={runCheck}
          onUpdate={handleUpdate}
        />
        <RunProgress run={run} remainingMs={remainingMs} showProgressBar={supportsProgressBytes} />
        <RunAlerts run={run} status={status} />
        <AutoUpdateRows
          enabled={config?.autoUpdate?.enabled === true}
          channel={channel}
          disabled={!isConnected || !(status?.updatable ?? false) || busy}
          onPatch={handleAutoUpdatePatch}
        />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  alert: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  runBlock: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  runHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  runLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  runHint: {
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
  channelRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
