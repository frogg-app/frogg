import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonBetaChannelStatusPayload } from "@frogg/client";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  INITIAL_BETA_DAEMON_RUN_STATE,
  isBetaDaemonRunBusy,
  reduceBetaDaemonRun,
  type BetaDaemonRunView,
} from "./beta-daemon-run";
import { siblingDaemonWebUrl } from "./daemon-web-url";
import { OpenWebUiButton } from "./open-web-ui-button";

const KNOWN_PHASES = new Set([
  "resolve",
  "download",
  "verify",
  "install",
  "uninstall",
  "done",
  "failed",
]);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type StatusState =
  | { kind: "loading" }
  | { kind: "loaded"; status: DaemonBetaChannelStatusPayload }
  | { kind: "error"; message: string };

/** Every added host, each with the side-by-side beta daemon it can install and remove. */
export function BetaDaemonHostsSection() {
  const { t } = useTranslation();
  const hosts = useHosts();
  return (
    <SettingsSection
      title={t("settings.developer.betaDaemon.title")}
      info={t("settings.developer.betaDaemon.info")}
      testID="developer-beta-daemon"
    >
      <View style={settingsStyles.card}>
        {hosts.length === 0 ? (
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("settings.developer.betaDaemon.noHosts")}</Text>
          </View>
        ) : (
          hosts.map((host, index) => (
            <BetaDaemonHostRow key={host.serverId} host={host} showBorder={index > 0} />
          ))
        )}
      </View>
    </SettingsSection>
  );
}

function BetaDaemonHostRow({ host, showBorder }: { host: HostProfile; showBorder: boolean }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const supported = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.betaChannelManagement === true,
  );
  const rowStyle = useMemo(
    () => [styles.hostBlock, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );

  let body: React.ReactNode;
  if (!isConnected) {
    body = <Text style={settingsStyles.rowHint}>{t("settings.developer.betaDaemon.offline")}</Text>;
  } else if (!supported) {
    body = (
      <Text style={settingsStyles.rowHint}>{t("settings.developer.betaDaemon.needsUpdate")}</Text>
    );
  } else {
    body = <BetaDaemonHostManager host={host} />;
  }

  return (
    <View style={rowStyle} testID={`developer-beta-daemon-host-${host.serverId}`}>
      <Text style={settingsStyles.rowTitle} numberOfLines={1}>
        {host.label}
      </Text>
      {body}
    </View>
  );
}

function BetaDaemonHostManager({ host }: { host: HostProfile }) {
  const { serverId, label: hostLabel } = host;
  const { t } = useTranslation();
  const canControl = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.daemonChannelControl === true,
  );
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const client = useHostRuntimeClient(serverId);
  const [statusState, setStatusState] = useState<StatusState>({ kind: "loading" });
  const [runState, dispatch] = useReducer(reduceBetaDaemonRun, INITIAL_BETA_DAEMON_RUN_STATE);
  const [purge, setPurge] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const status = await client.getBetaChannelStatus();
      if (!mounted.current) return;
      if (status.error) {
        setStatusState({ kind: "error", message: status.error });
        return;
      }
      setStatusState({ kind: "loaded", status });
      if (status.run) dispatch({ type: "resume", run: status.run });
    } catch (error) {
      if (mounted.current) setStatusState({ kind: "error", message: errorText(error) });
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!client) return;
    const offProgress = client.on("daemon.beta_channel.run.progress", (message) => {
      if (!mounted.current) return;
      dispatch({ type: "progress", run: message.payload.run, logLine: message.payload.logLine });
    });
    const offCompleted = client.on("daemon.beta_channel.run.completed", (message) => {
      if (!mounted.current) return;
      dispatch({ type: "completed", payload: message.payload });
      void refresh();
    });
    return () => {
      offProgress();
      offCompleted();
    };
  }, [client, refresh]);

  const busy = isBetaDaemonRunBusy(runState.view);

  const handleInstall = useCallback(async () => {
    if (!client) return;
    dispatch({ type: "start", action: "install" });
    try {
      const started = await client.installBetaChannel();
      if (!mounted.current) return;
      if (!started.accepted) {
        dispatch({
          type: "rejected",
          message: started.error ?? t("settings.developer.betaDaemon.phases.failed"),
        });
        return;
      }
      dispatch({ type: "accepted", runId: started.runId });
    } catch (error) {
      if (mounted.current) dispatch({ type: "rejected", message: errorText(error) });
    }
  }, [client, t]);

  const handleUninstall = useCallback(async () => {
    if (!client) return;
    const confirmed = await confirmDialog({
      title: t("settings.developer.betaDaemon.uninstallConfirmTitle"),
      message: purge
        ? t("settings.developer.betaDaemon.uninstallConfirmPurgeMessage", { host: hostLabel })
        : t("settings.developer.betaDaemon.uninstallConfirmMessage", { host: hostLabel }),
      confirmLabel: t("settings.developer.betaDaemon.uninstall"),
      destructive: true,
    });
    if (!confirmed || !mounted.current) return;
    dispatch({ type: "start", action: "uninstall" });
    try {
      const started = await client.uninstallBetaChannel({ purge });
      if (!mounted.current) return;
      if (!started.accepted) {
        dispatch({
          type: "rejected",
          message: started.error ?? t("settings.developer.betaDaemon.phases.failed"),
        });
        return;
      }
      dispatch({ type: "accepted", runId: started.runId });
    } catch (error) {
      if (mounted.current) dispatch({ type: "rejected", message: errorText(error) });
    }
  }, [client, hostLabel, purge, t]);

  const handleSetRunning = useCallback(
    async (running: boolean) => {
      if (!client) return;
      setControlBusy(true);
      setControlError(null);
      try {
        const result = running ? await client.startBetaChannel() : await client.stopBetaChannel();
        if (mounted.current && result.error) setControlError(result.error);
      } catch (error) {
        if (mounted.current) setControlError(errorText(error));
      }
      if (!mounted.current) return;
      setControlBusy(false);
      void refresh();
    },
    [client, refresh],
  );
  const handleStart = useCallback(() => void handleSetRunning(true), [handleSetRunning]);
  const handleStop = useCallback(() => void handleSetRunning(false), [handleSetRunning]);

  const handleToggleLog = useCallback(() => setShowLog((current) => !current), []);
  const handleRetry = useCallback(() => {
    setStatusState({ kind: "loading" });
    void refresh();
  }, [refresh]);

  if (statusState.kind === "loading") {
    return <Text style={settingsStyles.rowHint}>{t("settings.developer.loading")}</Text>;
  }
  if (statusState.kind === "error") {
    return (
      <View style={styles.statusRow}>
        <Text style={[settingsStyles.rowError, styles.flex]}>
          {t("settings.developer.betaDaemon.loadFailed", { error: statusState.message })}
        </Text>
        <Button variant="outline" size="sm" onPress={handleRetry}>
          {t("settings.developer.retry")}
        </Button>
      </View>
    );
  }

  const status = statusState.status;
  const webUrl =
    status.webRunning && status.webPort ? siblingDaemonWebUrl(host, status.webPort) : null;
  return (
    <View style={styles.manager}>
      <StatusLines status={status} />
      {canControl && status.supported && status.installed ? (
        <View style={styles.actions}>
          {status.running ? (
            <Button
              variant="outline"
              size="sm"
              onPress={handleStop}
              loading={controlBusy}
              disabled={busy}
              testID={`developer-beta-daemon-stop-${serverId}`}
            >
              {t("settings.developer.daemonControl.stop")}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onPress={handleStart}
              loading={controlBusy}
              disabled={busy}
              testID={`developer-beta-daemon-start-${serverId}`}
            >
              {t("settings.developer.daemonControl.start")}
            </Button>
          )}
          {webUrl ? (
            <OpenWebUiButton url={webUrl} testID={`developer-beta-daemon-open-${serverId}`} />
          ) : null}
        </View>
      ) : null}
      {controlError ? <InlineAlert variant="error" description={controlError} /> : null}
      {status.supported ? (
        <View style={styles.actions}>
          <InstallButton status={status} busy={busy} onPress={handleInstall} />
          {status.installed ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                onPress={handleUninstall}
                disabled={busy}
                testID={`developer-beta-daemon-uninstall-${serverId}`}
              >
                {t("settings.developer.betaDaemon.uninstall")}
              </Button>
              <View style={styles.purge}>
                <Switch
                  value={purge}
                  onValueChange={setPurge}
                  disabled={busy}
                  accessibilityLabel={t("settings.developer.betaDaemon.purge")}
                  testID={`developer-beta-daemon-purge-${serverId}`}
                />
                <Text style={settingsStyles.rowHint}>
                  {t("settings.developer.betaDaemon.purge")}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      ) : null}
      <RunStatus view={runState.view} />
      {runState.log.length > 0 ? (
        <View style={styles.logBlock}>
          <Button variant="ghost" size="sm" onPress={handleToggleLog} style={styles.logToggle}>
            {showLog
              ? t("settings.developer.betaDaemon.hideLog")
              : t("settings.developer.betaDaemon.showLog")}
          </Button>
          {showLog ? (
            <ScrollView style={styles.log} testID={`developer-beta-daemon-log-${serverId}`}>
              <Text style={styles.logText} selectable>
                {runState.log.join("\n")}
              </Text>
            </ScrollView>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function StatusLines({ status }: { status: DaemonBetaChannelStatusPayload }) {
  const { t } = useTranslation();
  const lines: string[] = [];
  if (status.selfIsBeta) lines.push(t("settings.developer.betaDaemon.selfIsBeta"));
  if (!status.supported) {
    lines.push(
      t("settings.developer.betaDaemon.unsupported", { reason: status.reason ?? status.platform }),
    );
  }
  lines.push(
    status.installed
      ? t("settings.developer.betaDaemon.installed", { version: status.installedVersion ?? "?" })
      : t("settings.developer.betaDaemon.notInstalled"),
  );
  if (status.installed) {
    lines.push(
      status.running
        ? t("settings.developer.betaDaemon.running", { port: status.port })
        : t("settings.developer.betaDaemon.stopped", { port: status.port }),
    );
  }
  lines.push(
    status.latestVersion
      ? t("settings.developer.betaDaemon.latest", { version: status.latestVersion })
      : t("settings.developer.betaDaemon.latestFailed", { error: status.latestError ?? "?" }),
  );
  return (
    <View style={styles.statusLines}>
      {lines.map((line) => (
        <Text key={line} style={settingsStyles.rowHint}>
          {line}
        </Text>
      ))}
    </View>
  );
}

function InstallButton({
  status,
  busy,
  onPress,
}: {
  status: DaemonBetaChannelStatusPayload;
  busy: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const latest = status.latestVersion;
  if (status.installed && latest && status.installedVersion === latest) {
    return <Text style={settingsStyles.rowHint}>{t("settings.developer.upToDate")}</Text>;
  }
  let label = t("settings.developer.betaDaemon.install");
  if (latest) {
    label = status.installed
      ? t("settings.developer.updateVersion", { version: latest })
      : t("settings.developer.installVersion", { version: latest });
  }
  return (
    <Button variant="default" size="sm" onPress={onPress} loading={busy}>
      {label}
    </Button>
  );
}

function RunStatus({ view }: { view: BetaDaemonRunView }) {
  const { t } = useTranslation();
  if (view.kind === "idle") return null;
  if (view.kind === "error") {
    return <InlineAlert variant="error" description={view.message} />;
  }
  if (view.kind === "completed") {
    if (view.status === "failed") {
      return (
        <InlineAlert
          variant="error"
          description={t("settings.developer.betaDaemon.failed", {
            error: view.error ?? t("settings.developer.betaDaemon.phases.failed"),
          })}
        />
      );
    }
    return (
      <InlineAlert
        variant="success"
        description={
          view.action === "uninstall"
            ? t("settings.developer.betaDaemon.uninstallSucceeded")
            : t("settings.developer.betaDaemon.installSucceeded", { version: view.version ?? "" })
        }
      />
    );
  }
  let phaseLabel = t("settings.developer.betaDaemon.starting");
  let message: string | null = null;
  if (view.kind === "running") {
    phaseLabel = KNOWN_PHASES.has(view.run.phase)
      ? t(`settings.developer.betaDaemon.phases.${view.run.phase}`)
      : view.run.phase;
    message = view.run.message;
  }
  return (
    <View style={styles.statusLines}>
      <Text style={styles.phase}>{phaseLabel}</Text>
      {message ? <Text style={settingsStyles.rowHint}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  hostBlock: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
    gap: theme.spacing[2],
  },
  manager: {
    gap: theme.spacing[3],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  flex: {
    flex: 1,
  },
  statusLines: {
    gap: theme.spacing[1],
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  purge: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  phase: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  logBlock: {
    gap: theme.spacing[2],
    alignItems: "flex-start",
  },
  logToggle: {
    paddingHorizontal: 0,
  },
  log: {
    alignSelf: "stretch",
    maxHeight: 200,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    padding: theme.spacing[2],
  },
  logText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontFamily: "monospace",
  },
}));
