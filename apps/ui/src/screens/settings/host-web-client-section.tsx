/**
 * COMPAT(webUiControl): added in v1.6.7.
 *
 * Host → Web client: the daemon's own web server for the browser app, on its own port. Start and
 * stop it, choose whether it starts with the daemon, pick the interface it binds, and open it.
 * Hidden inside the browser app itself: a page must not be able to switch off the server that
 * serves it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { DaemonWebUiStatusPayload } from "@frogg/client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { Switch } from "@/components/ui/switch";
import { getIsElectron, isWeb } from "@/constants/platform";
import { connectionNetworkHost } from "@/hosts/daemon-conflicts";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected, useHosts } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { openExternalUrl } from "@/utils/open-external-url";

function interfaceDescription(name: string, t: (key: string) => string): string {
  if (name === "loopback") return t("settings.host.webClient.loopback");
  if (name === "all") return t("settings.host.webClient.allInterfaces");
  return name;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Where to open the web client: its bound address, or the host's own address when bound wide. */
export function webClientUrl(
  status: Pick<DaemonWebUiStatusPayload, "host" | "port">,
  hostAddress: string | null,
): string | null {
  let address: string | null = status.host;
  if (status.host === "0.0.0.0") address = hostAddress === "localhost" ? "127.0.0.1" : hostAddress;
  if (!address) return null;
  return `http://${address.includes(":") ? `[${address}]` : address}:${status.port}`;
}

export function HostWebClientSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const supported = useHostFeature(serverId, "webUiControl");
  const isConnected = useHostRuntimeIsConnected(serverId);
  // The browser app is served by this very server; only other clients manage it.
  if (isWeb && !getIsElectron()) return null;
  if (!supported || !isConnected) return null;
  return (
    <SettingsSection
      title={t("settings.host.webClient.title")}
      info={t("settings.host.webClient.info")}
      testID="host-page-web-client"
    >
      <WebClientCard serverId={serverId} />
    </SettingsSection>
  );
}

function WebClientCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const hosts = useHosts();
  const [status, setStatus] = useState<DaemonWebUiStatusPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const hostAddress = useMemo(() => {
    const host = hosts.find((candidate) => candidate.serverId === serverId);
    const connection =
      host?.connections.find((candidate) => candidate.id === host.preferredConnectionId) ??
      host?.connections[0];
    return connection ? connectionNetworkHost(connection) : null;
  }, [hosts, serverId]);

  const apply = useCallback(async (action: () => Promise<DaemonWebUiStatusPayload>) => {
    setBusy(true);
    setActionError(null);
    try {
      const next = await action();
      if (!mounted.current) return;
      setStatus(next);
      setLoadError(null);
      if (next.error) setActionError(next.error);
    } catch (error) {
      if (mounted.current) setActionError(errorMessage(error));
    }
    if (mounted.current) setBusy(false);
  }, []);

  useEffect(() => {
    if (!client) return;
    const load = async () => {
      try {
        const next = await client.getWebUiStatus();
        if (mounted.current) setStatus(next);
      } catch (error) {
        if (mounted.current) setLoadError(errorMessage(error));
      }
    };
    void load();
  }, [client]);

  const handleToggleRunning = useCallback(() => {
    if (!client || !status) return;
    void apply(() => (status.running ? client.stopWebUi() : client.startWebUi()));
  }, [apply, client, status]);

  const handleStartOnLaunch = useCallback(
    (value: boolean) => {
      if (client) void apply(() => client.updateWebUi({ startOnLaunch: value }));
    },
    [apply, client],
  );

  const handleHost = useCallback(
    (host: string) => {
      if (client) void apply(() => client.updateWebUi({ host }));
    },
    [apply, client],
  );

  const options = useMemo<SelectFieldOption<string>[]>(
    () =>
      (status?.interfaces ?? []).map((entry) => ({
        id: entry.address,
        value: entry.address,
        label: entry.address,
        description: interfaceDescription(entry.name, t),
        testID: `host-web-client-interface-${entry.address}`,
      })),
    [status?.interfaces, t],
  );

  const url = status?.running ? webClientUrl(status, hostAddress) : null;
  const selected = options.find((option) => option.value === status?.host) ?? null;
  const selectedDisplay = useMemo(
    () => (selected ? { label: selected.label, description: selected.description } : null),
    [selected],
  );
  const handleOpen = useCallback(() => void openExternalUrl(url), [url]);

  if (loadError) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowError}>
            {t("settings.host.webClient.loadFailed", { error: loadError })}
          </Text>
        </View>
      </View>
    );
  }
  if (!status) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>{t("settings.developer.loading")}</Text>
        </View>
      </View>
    );
  }
  if (!status.available) {
    return (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Text style={settingsStyles.rowHint}>{t("settings.host.webClient.unavailable")}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={settingsStyles.card}>
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {status.running
              ? t("settings.host.webClient.running", { port: status.port })
              : t("settings.host.webClient.stopped", { port: status.port })}
          </Text>
          {url ? (
            <Text
              style={styles.link}
              onPress={handleOpen}
              accessibilityRole="link"
              testID="host-web-client-link"
            >
              {url}
            </Text>
          ) : null}
        </View>
        <Button
          variant={status.running ? "outline" : "default"}
          size="sm"
          onPress={handleToggleRunning}
          loading={busy}
          testID={status.running ? "host-web-client-stop" : "host-web-client-start"}
        >
          {status.running
            ? t("settings.developer.daemonControl.stop")
            : t("settings.developer.daemonControl.start")}
        </Button>
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.webClient.startOnLaunch")}</Text>
          <Text style={settingsStyles.rowHint}>
            {status.startOnLaunchPinned
              ? t("settings.host.webClient.startOnLaunchPinned")
              : t("settings.host.webClient.startOnLaunchHint")}
          </Text>
        </View>
        <Switch
          value={status.startOnLaunch}
          onValueChange={handleStartOnLaunch}
          disabled={busy || status.startOnLaunchPinned}
          accessibilityLabel={t("settings.host.webClient.startOnLaunch")}
          testID="host-web-client-start-on-launch"
        />
      </View>
      <View style={[styles.interfaceRow, settingsStyles.rowBorder]}>
        <SelectField
          label={t("settings.host.webClient.interface")}
          value={status.host}
          selectedDisplay={selectedDisplay}
          options={options}
          onChange={handleHost}
          placeholder={status.host}
          emptyText={t("settings.host.webClient.noInterfaces")}
          disabled={busy}
          hint={t("settings.host.webClient.interfaceHint")}
          testID="host-web-client-interface"
        />
      </View>
      {actionError ? (
        <View style={styles.errorRow}>
          <Alert variant="error" description={actionError} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  link: {
    color: theme.colors.accent,
    fontSize: theme.fontSize.sm,
    textDecorationLine: "underline",
  },
  interfaceRow: {
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  errorRow: {
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[3],
  },
}));
