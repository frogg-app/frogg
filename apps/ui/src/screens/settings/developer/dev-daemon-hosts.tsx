import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { DaemonDevDaemonStatusPayload } from "@frogg/client";
import type { DaemonDevDaemonCheckout } from "@frogg/protocol/messages";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostProfile } from "@/types/host-connection";
import { siblingDaemonWebUrl } from "./daemon-web-url";
import { OpenWebUiButton } from "./open-web-ui-button";

/** While a launched daemon is still coming up, poll until it answers. */
const STARTING_POLL_MS = 3000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type StatusState =
  | { kind: "loading" }
  | { kind: "loaded"; status: DaemonDevDaemonStatusPayload }
  | { kind: "error"; message: string };

export function DevDaemonHostRow({
  host,
  showBorder,
  showLabel = true,
}: {
  host: HostProfile;
  showBorder: boolean;
  /** Off on the host's own page, where the host is already the page's subject. */
  showLabel?: boolean;
}) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const supported = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.daemonChannelControl === true,
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
      <Text style={settingsStyles.rowHint}>{t("settings.developer.devDaemon.needsUpdate")}</Text>
    );
  } else {
    body = <DevDaemonHostManager host={host} />;
  }

  return (
    <View style={rowStyle} testID={`developer-dev-daemon-host-${host.serverId}`}>
      {showLabel ? (
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {host.label}
        </Text>
      ) : null}
      {body}
    </View>
  );
}

function DevDaemonHostManager({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(host.serverId);
  const [statusState, setStatusState] = useState<StatusState>({ kind: "loading" });
  const [busyCwd, setBusyCwd] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
      const status = await client.getDevDaemonStatus();
      if (!mounted.current) return;
      setStatusState(
        status.error ? { kind: "error", message: status.error } : { kind: "loaded", status },
      );
    } catch (error) {
      if (mounted.current) setStatusState({ kind: "error", message: errorText(error) });
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const starting =
    statusState.kind === "loaded" && statusState.status.running && !statusState.status.ready;
  useEffect(() => {
    if (!starting) return;
    const timer = setInterval(() => void refresh(), STARTING_POLL_MS);
    return () => clearInterval(timer);
  }, [starting, refresh]);

  const run = useCallback(
    async (cwd: string, action: () => Promise<{ error: string | null }>) => {
      setBusyCwd(cwd);
      setActionError(null);
      try {
        const result = await action();
        if (mounted.current && result.error) setActionError(result.error);
      } catch (error) {
        if (mounted.current) setActionError(errorText(error));
      }
      if (!mounted.current) return;
      setBusyCwd(null);
      void refresh();
    },
    [refresh],
  );

  const handleLaunch = useCallback(
    (cwd: string) => {
      if (client) void run(cwd, () => client.startDevDaemon(cwd));
    },
    [client, run],
  );
  const handleStop = useCallback(
    (cwd: string) => {
      if (client) void run(cwd, () => client.stopDevDaemon());
    },
    [client, run],
  );

  if (statusState.kind === "loading") {
    return <Text style={settingsStyles.rowHint}>{t("settings.developer.loading")}</Text>;
  }
  if (statusState.kind === "error") {
    return (
      <Text style={settingsStyles.rowError}>
        {t("settings.developer.devDaemon.loadFailed", { error: statusState.message })}
      </Text>
    );
  }

  const status = statusState.status;
  if (!status.supported) {
    return <Text style={settingsStyles.rowHint}>{status.reason}</Text>;
  }
  const webUrl = status.ready ? siblingDaemonWebUrl(host, status.webPort) : null;

  return (
    <View style={styles.manager}>
      <Text style={settingsStyles.rowHint}>
        {status.running
          ? t(
              status.ready
                ? "settings.developer.devDaemon.running"
                : "settings.developer.devDaemon.starting",
              { port: status.daemonPort },
            )
          : t("settings.developer.devDaemon.stopped")}
      </Text>
      {webUrl ? (
        <OpenWebUiButton url={webUrl} testID={`developer-dev-daemon-open-${host.serverId}`} />
      ) : null}
      {status.checkouts.length === 0 ? (
        <Text style={settingsStyles.rowHint}>{t("settings.developer.devDaemon.noCheckouts")}</Text>
      ) : (
        <View style={styles.checkouts}>
          {status.checkouts.map((checkout) => (
            <CheckoutRow
              key={checkout.cwd}
              checkout={checkout}
              active={status.running && status.cwd === checkout.cwd}
              busy={busyCwd === checkout.cwd}
              disabled={busyCwd !== null}
              onLaunch={handleLaunch}
              onStop={handleStop}
            />
          ))}
        </View>
      )}
      {status.running && status.logPath ? (
        <Text style={settingsStyles.rowHint} selectable>
          {t("settings.developer.devDaemon.log", { path: status.logPath })}
        </Text>
      ) : null}
      {actionError ? <InlineAlert variant="error" description={actionError} /> : null}
    </View>
  );
}

function CheckoutRow({
  checkout,
  active,
  busy,
  disabled,
  onLaunch,
  onStop,
}: {
  checkout: DaemonDevDaemonCheckout;
  active: boolean;
  busy: boolean;
  disabled: boolean;
  onLaunch: (cwd: string) => void;
  onStop: (cwd: string) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(
    () => (active ? onStop(checkout.cwd) : onLaunch(checkout.cwd)),
    [active, checkout.cwd, onLaunch, onStop],
  );
  return (
    <View style={styles.checkout}>
      <View style={styles.flex}>
        <Text style={styles.checkoutName} numberOfLines={1}>
          {checkout.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {checkout.branch ? `${checkout.branch} · ${checkout.cwd}` : checkout.cwd}
        </Text>
      </View>
      <Button
        variant={active ? "outline" : "default"}
        size="sm"
        loading={busy}
        disabled={disabled}
        onPress={handlePress}
        testID={`developer-dev-daemon-${active ? "stop" : "launch"}-${checkout.cwd}`}
      >
        {active
          ? t("settings.developer.daemonControl.stop")
          : t("settings.developer.devDaemon.launch")}
      </Button>
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
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  checkouts: {
    gap: theme.spacing[2],
  },
  checkout: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  checkoutName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
}));
