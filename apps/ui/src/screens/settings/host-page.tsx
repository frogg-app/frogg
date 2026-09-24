import { describeHostConnectionError } from "@/runtime/host-connection-error";
import { brand } from "@frogg/branding";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpToLine,
  ChevronRight,
  Pencil,
  Plus,
  RotateCw,
  SquareTerminal,
  Trash2,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, View } from "react-native";
import { StyleSheet, useUnistyles, withUnistyles } from "react-native-unistyles";
import type { TerminalProfile } from "@frogg/protocol/messages";
import {
  getTerminalProfileIcon,
  DEFAULT_TERMINAL_PROFILES,
} from "@frogg/protocol/terminal-profiles";
import { AgentProfilesSection } from "@/agent-profiles";
import { AgentSkillsSection } from "@/agent-skills";
import { ProviderAgentDefinitionsSection } from "@/agent-definitions";
import { MetadataGenerationPage } from "@/screens/settings/metadata-generation-page";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { Alert as InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import {
  ProfileDraft,
  TerminalProfileEditModal,
} from "@/screens/settings/terminal-profile-edit-modal";
import {
  getDesktopDaemonStatus,
  shouldUseDesktopDaemon,
  restartDesktopDaemon,
  startDesktopDaemon,
  stopDesktopDaemon,
} from "@/desktop/daemon/desktop-daemon";
import { LocalDaemonSection } from "@/desktop/components/desktop-updates-section";
import { DaemonConflictWarning } from "@/hosts/daemon-conflict-warning";
import { useDaemonStatus } from "@/desktop/hooks/use-daemon-status";
import { loadDesktopSettings, useDesktopSettings } from "@/desktop/settings/desktop-settings";
import { PairDeviceModal } from "@/desktop/components/pair-device-modal";
import { DevicesList } from "@/device-access/devices-list";
import { PairingCodeCard } from "@/device-access/pairing-code-card";
import { PairingRequestsCard } from "@/device-access/pairing-requests-card";
import { RoleBadge } from "@/device-access/role-badge";
import { useDeviceAccess } from "@/device-access/use-device-access";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useIsLocalDaemon } from "@/hooks/use-is-local-daemon";
import {
  getHostRuntimeStore,
  isHostRuntimeConnected,
  useHostMutations,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
  useHosts,
} from "@/runtime/host-runtime";
import { ProvidersSection } from "@/screens/settings/providers-section";
import { ProviderUsageSettingsSection } from "@/provider-usage/settings-section";
import { useProviderUsage, useRefreshHostProviderUsage } from "@/provider-usage/use-provider-usage";
import { buildUsageAccountsByProvider } from "@/provider-usage/accounts";
import { useProviderAccounts } from "@/provider-accounts/use-provider-accounts";
import { withDefaultAccount } from "@/screens/settings/provider-settings-modal/account-tabs";
import { HostAppearanceSection } from "@/screens/settings/host-appearance-section";
import { HostDaemonUpdateSection } from "@/screens/settings/host-daemon-update-section";
import { HostSshDeploySection } from "@/screens/settings/host-ssh-deploy-section";
import { SettingsSection } from "@/screens/settings/settings-section";
import { useSessionStore } from "@/stores/session-store";
import { settingsStyles } from "@/styles/settings";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { confirmDialog } from "@/utils/confirm-dialog";
import { isVersionMismatch } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { formatLatency } from "@/utils/latency";
import { ICON_SIZE } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { getProviderIcon } from "@/components/provider-icons";
import { BrowserToolsOptInCard } from "./browser-tools-card";
import { hasDaemonReconnectedAfter, type DaemonConnectionMarker } from "./daemon-reconnect";
import { restartDaemonFromSettings } from "./daemon-restart";
import { formatHostConnectionLabel } from "./host-connection-display";
import { HostStatusBadges } from "./host-status-badges";

const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const ThemedProfilePencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);
const ThemedProfileSquareTerminal = withUnistyles(SquareTerminal);
const ThemedPlus = withUnistyles(Plus);

interface DynamicProviderIconProps {
  iconKey: string;
  size: number;
  color?: string;
}

function DynamicProviderIcon({ iconKey, size, color = "" }: DynamicProviderIconProps) {
  const Icon = getProviderIcon(iconKey);
  return <Icon size={size} color={color} />;
}

const ThemedDynamicProviderIcon = withUnistyles(DynamicProviderIcon);

const mutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const destructiveColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});

const moveUpIcon = <ThemedArrowUp size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const editProfileIcon = <ThemedProfilePencil size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const removeProfileIcon = <ThemedTrash2 size={ICON_SIZE.sm} uniProps={destructiveColorMapping} />;
const addProfileIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

function useHostProfile(serverId: string): HostProfile | null {
  const daemons = useHosts();
  return daemons.find((entry) => entry.serverId === serverId) ?? null;
}

function HostNotFound() {
  const { t } = useTranslation();
  return (
    <View>
      <View style={[settingsStyles.card, styles.emptyCard]}>
        <Text style={styles.emptyText}>{t("settings.host.notFound")}</Text>
      </View>
    </View>
  );
}

function HostConnectionError({ serverId, host }: { serverId: string; host: HostProfile }) {
  const { t } = useTranslation();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const connectionError = describeHostConnectionError(snapshot);
  if (!connectionError) return null;
  const hasRemoteSsh = host.connections.some((connection) => connection.type === "remoteSsh");
  return (
    <Text style={styles.errorText} testID="host-connection-error" accessibilityRole="alert">
      {hasRemoteSsh
        ? t("settings.host.connectionErrors.remoteSsh", { detail: connectionError })
        : connectionError}
    </Text>
  );
}

export function HostPairDevicePage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <SettingsSection title={t("settings.host.pairDevices.title")}>
      <PairDeviceRow serverId={serverId} />
      <RelayEndpointCard serverId={serverId} />
    </SettingsSection>
  );
}

/**
 * Who can reach this daemon. Every block gates itself on what the daemon
 * advertises and on this device's own role, so an operator or a viewer sees
 * the device list and an explanation instead of buttons that would be refused.
 */
export function HostDevicesPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const access = useDeviceAccess(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <SettingsSection title={t("deviceAccess.callerRole.title")} testID="host-devices-caller-role">
        <CallerRoleCard serverId={serverId} />
      </SettingsSection>

      {access.canDecidePairingRequests ? (
        <SettingsSection title={t("deviceAccess.requests.title")} testID="host-devices-requests">
          <PairingRequestsCard serverId={serverId} />
        </SettingsSection>
      ) : null}

      <SettingsSection title={t("deviceAccess.devices.title")} testID="host-devices-list">
        <DevicesList serverId={serverId} />
      </SettingsSection>

      {access.canCreatePairingCode ? (
        <SettingsSection title={t("deviceAccess.code.title")} testID="host-devices-code">
          <PairingCodeCard serverId={serverId} />
        </SettingsSection>
      ) : null}
    </View>
  );
}

/** This device's own role, so a refusal elsewhere has somewhere to point. */
function CallerRoleCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const access = useDeviceAccess(serverId);
  if (!access.handshakeSeen) {
    return <Text style={styles.emptyText}>{t("deviceAccess.callerRole.unknown")}</Text>;
  }
  if (!access.roles) {
    return <Text style={styles.emptyText}>{t("deviceAccess.callerRole.unsupported")}</Text>;
  }
  return (
    <View style={styles.callerRoleRow} testID="caller-role">
      <RoleBadge role={access.callerRole} />
      <Text style={styles.emptyText}>
        {access.hasDeviceCredential
          ? t(`deviceAccess.roles.${access.callerRole}.description`)
          : t("deviceAccess.callerRole.noCredential")}
      </Text>
    </View>
  );
}

export function HostAgentsPage({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <ProviderAgentDefinitionsSection serverId={serverId} />
      {isConnected ? (
        <SettingsSection title={t("settings.hostSections.agents")}>
          <InjectFroggToolsCard serverId={serverId} />
          <BrowserToolsOptInCard serverId={serverId} />
          <AppendSystemPromptCard serverId={serverId} />
        </SettingsSection>
      ) : (
        <View style={[settingsStyles.card, styles.emptyCard]}>
          <Text style={styles.emptyText}>{t("settings.host.agents.unavailable")}</Text>
        </View>
      )}
      <AgentSkillsSection serverId={serverId} />
      <AgentProfilesSection serverId={serverId} />
    </View>
  );
}

export function HostProvidersPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <ProvidersSection serverId={serverId} />
    </View>
  );
}

/** Deployment is separate from Overview so an SSH host's lifecycle is explicit. */
export function HostDeployPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);
  if (!host) return <HostNotFound />;
  return <HostSshDeploySection host={host} />;
}

export function HostUsagePage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);
  const { view: providerUsageView } = useProviderUsage(serverId);
  const accounts = useProviderAccounts(serverId);
  // Refreshing has to reach the per-account queries each card makes for itself,
  // not only the unscoped list this page holds.
  const handleRefresh = useRefreshHostProviderUsage(serverId);
  const accountsByProvider = useMemo(
    () => buildUsageAccountsByProvider(accounts.payload?.accounts ?? [], withDefaultAccount),
    [accounts.payload],
  );

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <ProviderUsageSettingsSection
        view={providerUsageView}
        onRefresh={handleRefresh}
        serverId={serverId}
        accountsByProvider={accountsByProvider}
      />
    </View>
  );
}

export function HostSettingsPage({
  serverId,
  onHostRemoved,
}: {
  serverId: string;
  onHostRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const host = useHostProfile(serverId);
  const isLocalDaemon = useIsLocalDaemon(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <View style={styles.daemonHeader}>
        <Text style={styles.daemonHeaderLabel} numberOfLines={1}>
          {host.label}
        </Text>
      </View>

      <HostStatusBadges host={host} />
      {/* Right under the status, so the reason for an error badge is visible first. */}
      <HostConnectionError serverId={serverId} host={host} />

      <HostAppearanceSection host={host} />

      {isLocalDaemon ? <LocalDaemonSection /> : null}

      {!isLocalDaemon ? <UpdateDaemonCard key={host.serverId} host={host} /> : null}

      {/* Any transport: the daemon itself reports whether it can self-update. */}
      <HostDaemonUpdateSection key={`self-update-${host.serverId}`} host={host} />

      <DaemonConflictWarning serverId={serverId} />
      <ConnectionsSection host={host} />

      {isConnected ? (
        <SettingsSection title={t("settings.hostSections.workspaces")}>
          <AutoArchiveMergedWorkspacesCard serverId={serverId} />
        </SettingsSection>
      ) : null}

      {isConnected ? <MetadataGenerationPage serverId={serverId} /> : null}

      <RemoveHostSection host={host} isLocalDaemon={isLocalDaemon} onRemoved={onHostRemoved} />
    </View>
  );
}

function ConnectionsSection({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { removeConnection } = useHostMutations();
  const snapshot = useHostRuntimeSnapshot(host.serverId);
  const probeByConnectionId = snapshot?.probeByConnectionId ?? new Map();
  const [pendingRemoveConnection, setPendingRemoveConnection] = useState<{
    connectionId: string;
    title: string;
  } | null>(null);
  const [isRemovingConnection, setIsRemovingConnection] = useState(false);
  const removeConnectionHeader = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.connections.removeTitle") }),
    [t],
  );

  const handleRequestRemove = useCallback(
    (connection: HostConnection) => {
      setPendingRemoveConnection({
        connectionId: connection.id,
        title: formatHostConnectionLabel(connection, t),
      });
    },
    [t],
  );

  const handleCloseConfirm = useCallback(() => {
    if (isRemovingConnection) return;
    setPendingRemoveConnection(null);
  }, [isRemovingConnection]);

  const handleCancelConfirm = useCallback(() => {
    setPendingRemoveConnection(null);
  }, []);

  const handleConfirmRemove = useCallback(() => {
    if (!pendingRemoveConnection) return;
    const { connectionId } = pendingRemoveConnection;
    setIsRemovingConnection(true);
    void removeConnection(host.serverId, connectionId)
      .then(() => setPendingRemoveConnection(null))
      .catch((error) => {
        console.error("[HostPage] Failed to remove connection", error);
        Alert.alert(
          t("settings.host.connections.removeErrorTitle"),
          t("settings.host.connections.removeErrorMessage"),
        );
      })
      .finally(() => setIsRemovingConnection(false));
  }, [pendingRemoveConnection, removeConnection, host.serverId, t]);

  return (
    <SettingsSection title={t("settings.host.connections.title")}>
      <View style={settingsStyles.card} testID="host-page-connections-card">
        {host.connections.map((conn, index) => {
          const probe = probeByConnectionId.get(conn.id);
          return (
            <ConnectionRow
              key={conn.id}
              connection={conn}
              showBorder={index > 0}
              latencyMs={probe?.status === "available" ? probe.latencyMs : undefined}
              latencyLoading={!probe || probe.status === "pending"}
              latencyError={probe?.status === "unavailable"}
              onRemove={handleRequestRemove}
            />
          );
        })}
      </View>

      {pendingRemoveConnection ? (
        <AdaptiveModalSheet
          header={removeConnectionHeader}
          visible
          onClose={handleCloseConfirm}
          testID="remove-connection-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {t("settings.host.connections.removeMessage", {
              name: pendingRemoveConnection.title,
            })}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="secondary"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleCancelConfirm}
              disabled={isRemovingConnection}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleConfirmRemove}
              disabled={isRemovingConnection}
              testID="remove-connection-confirm"
            >
              {t("settings.host.connections.removeAction")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

function ConnectionRow({
  connection,
  showBorder,
  latencyMs,
  latencyLoading,
  latencyError,
  onRemove,
}: {
  connection: HostConnection;
  showBorder: boolean;
  latencyMs: number | null | undefined;
  latencyLoading: boolean;
  latencyError: boolean;
  onRemove: (connection: HostConnection) => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const title = formatHostConnectionLabel(connection, t);

  const latencyText = (() => {
    if (latencyLoading) return "...";
    if (latencyError) return t("settings.host.connections.timeout");
    if (latencyMs != null) return formatLatency(latencyMs);
    return "—";
  })();
  const latencyColor = latencyError ? theme.colors.palette.red[300] : theme.colors.foregroundMuted;

  const handlePressRemove = useCallback(() => {
    onRemove(connection);
  }, [onRemove, connection]);

  const rowStyle = useMemo(
    () => [settingsStyles.row, showBorder && settingsStyles.rowBorder],
    [showBorder],
  );
  const latencyTextStyle = useMemo(
    () => [styles.connectionLatency, { color: latencyColor }],
    [latencyColor],
  );
  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );

  return (
    <View style={rowStyle}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Text style={latencyTextStyle}>{latencyText}</Text>
      <Button
        variant="ghost"
        size="sm"
        textStyle={destructiveTextStyle}
        onPress={handlePressRemove}
      >
        {t("settings.host.connections.removeAction")}
      </Button>
    </View>
  );
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function RestartDaemonCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [isRestarting, setIsRestarting] = useState(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(
    async (restartRequest: Promise<void>) => {
      const disconnectTimeoutMs = 30000;
      const reconnectTimeoutMs = 30000;
      const requestFailureDisconnectGraceMs = 2000;
      const disconnectedPromise = isHostConnected()
        ? waitForCondition(() => !isHostConnected(), disconnectTimeoutMs)
        : Promise.resolve(true);
      const restartResult = await restartRequest.then(
        () => ({ status: "accepted" as const }),
        async (error) => ({
          status: "rejected" as const,
          error,
          disconnectedAfterFailure: await waitForCondition(
            () => !isHostConnected(),
            requestFailureDisconnectGraceMs,
            100,
          ),
        }),
      );
      if (!isMountedRef.current) return;

      if (restartResult.status === "rejected" && !restartResult.disconnectedAfterFailure) {
        console.error(`[HostPage] Failed to restart daemon ${host.label}`, restartResult.error);
        setIsRestarting(false);
        Alert.alert(
          t("settings.host.daemon.restart.requestFailedTitle"),
          t("settings.host.daemon.restart.requestFailedMessage"),
        );
        return;
      }

      const disconnected =
        restartResult.status === "rejected"
          ? restartResult.disconnectedAfterFailure
          : await disconnectedPromise;
      const reconnected =
        disconnected && (await waitForCondition(() => isHostConnected(), reconnectTimeoutMs));
      if (isMountedRef.current) {
        setIsRestarting(false);
        if (!reconnected) {
          Alert.alert(
            t("settings.host.daemon.restart.unableToReconnectTitle"),
            t("settings.host.daemon.restart.unableToReconnectMessage", {
              name: host.label,
            }),
          );
        }
      }
    },
    [host.label, isHostConnected, t, waitForCondition],
  );

  const handleRestart = useCallback(() => {
    if (!daemonClient) {
      Alert.alert(
        t("settings.host.daemon.restart.unavailableTitle"),
        t("settings.host.daemon.restart.unavailableMessage"),
      );
      return;
    }
    if (!isHostConnected()) {
      Alert.alert(
        t("settings.host.daemon.restart.offlineTitle"),
        t("settings.host.daemon.restart.offlineMessage"),
      );
      return;
    }

    // No confirmation: a restart loses nothing. Agents on the daemon keep running and the
    // app reconnects by itself, which is exactly what the row's hint already says.
    setIsRestarting(true);
    const restartRequest = restartDaemonFromSettings(
      host.serverId,
      `settings_daemon_restart_${host.serverId}`,
      {
        getIsElectron: shouldUseDesktopDaemon,
        getDesktopDaemonStatus,
        getDesktopSettings: loadDesktopSettings,
        restartDesktopDaemon,
        restartServer: (reason) => daemonClient.restartServer(reason),
      },
    );
    void waitForDaemonRestart(restartRequest);
  }, [daemonClient, host.serverId, isHostConnected, t, waitForDaemonRestart]);

  const restartIcon = useMemo(
    () => <RotateCw size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  return (
    <View style={settingsStyles.card} testID="host-page-restart-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.daemon.restart.title")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.daemon.restart.hint")}</Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={restartIcon}
          onPress={handleRestart}
          disabled={isRestarting || !daemonClient || !isConnected}
          testID="host-page-restart-button"
        >
          {isRestarting
            ? t("settings.host.daemon.restart.restarting")
            : t("settings.host.daemon.restart.action")}
        </Button>
      </View>
    </View>
  );
}

type DaemonUpdateState =
  | { status: "idle" }
  | { status: "updating"; phase: string }
  | { status: "failed"; title: string; message: string };

function UpdateDaemonCard({ host }: { host: HostProfile }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const daemonClient = useHostRuntimeClient(host.serverId);
  const isConnected = useHostRuntimeIsConnected(host.serverId);
  const runtime = getHostRuntimeStore();
  const [updateState, setUpdateState] = useState<DaemonUpdateState>({
    status: "idle",
  });
  const isMountedRef = useRef(true);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const daemonVersion = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.version ?? null,
  );
  const supportsSelfUpdate = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.features?.daemonSelfUpdate === true,
  );
  const desktopManaged = useSessionStore(
    (state) => state.sessions[host.serverId]?.serverInfo?.desktopManaged === true,
  );

  const appVersion = resolveAppVersion();
  const hasVersionMismatch = isVersionMismatch(appVersion, daemonVersion);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      unsubscribeRef.current?.();
    };
  }, []);

  const isHostConnected = useCallback(
    () => isHostRuntimeConnected(runtime.getSnapshot(host.serverId)),
    [host.serverId, runtime],
  );
  const hasReconnectedAfter = useCallback(
    (startMarker: DaemonConnectionMarker | null) =>
      hasDaemonReconnectedAfter(runtime.getSnapshot(host.serverId), startMarker),
    [host.serverId, runtime],
  );

  const waitForCondition = useCallback(
    async (predicate: () => boolean, timeoutMs: number, intervalMs = 250) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isMountedRef.current) return false;
        if (predicate()) return true;
        await delay(intervalMs);
      }
      return predicate();
    },
    [],
  );

  const waitForDaemonRestart = useCallback(
    async (startMarker: DaemonConnectionMarker | null) => {
      const disconnectTimeoutMs = 15000;
      const reconnectTimeoutMs = 120000; // 2 minutes — npm update + restart can take a while
      if (!hasReconnectedAfter(startMarker) && isHostConnected()) {
        await waitForCondition(
          () => !isHostConnected() || hasReconnectedAfter(startMarker),
          disconnectTimeoutMs,
        );
      }
      const reconnected =
        hasReconnectedAfter(startMarker) ||
        (await waitForCondition(() => hasReconnectedAfter(startMarker), reconnectTimeoutMs));
      if (isMountedRef.current) {
        if (!reconnected) {
          setUpdateState({
            status: "failed",
            title: t("settings.host.daemon.update.unableToReconnectTitle"),
            message: t("settings.host.daemon.update.unableToReconnectMessage", {
              name: host.label,
            }),
          });
          return;
        }
        setUpdateState({ status: "idle" });
      }
    },
    [hasReconnectedAfter, host.label, isHostConnected, t, waitForCondition],
  );

  const handleUpdate = useCallback(() => {
    if (!daemonClient) {
      setUpdateState({
        status: "failed",
        title: t("settings.host.daemon.update.unavailableTitle"),
        message: t("settings.host.daemon.update.unavailableMessage"),
      });
      return;
    }
    if (!isHostConnected()) {
      setUpdateState({
        status: "failed",
        title: t("settings.host.daemon.update.offlineTitle"),
        message: t("settings.host.daemon.update.offlineMessage"),
      });
      return;
    }

    // No confirmation: nothing is lost, and the hint says running agents are briefly
    // interrupted. The button already names the action.
    if (!isMountedRef.current) return;
    const startSnapshot = runtime.getSnapshot(host.serverId);
    const startMarker = startSnapshot
      ? {
          clientGeneration: startSnapshot.clientGeneration,
          lastOnlineAt: startSnapshot.lastOnlineAt,
        }
      : null;
    setUpdateState({
      status: "updating",
      phase: t("settings.host.daemon.update.phaseStarting"),
    });
    const requestId = `settings_daemon_update_${host.serverId}`;

    const unsubscribe = daemonClient.on("daemon.update.progress", (message) => {
      if (message.payload.requestId !== requestId) return;
      if (!isMountedRef.current) return;
      const { phase } = message.payload;
      if (phase === "starting")
        setUpdateState({
          status: "updating",
          phase: t("settings.host.daemon.update.phaseStarting"),
        });
      else if (phase === "downloading")
        setUpdateState({
          status: "updating",
          phase: t("settings.host.daemon.update.phaseDownloading"),
        });
      else if (phase === "installing")
        setUpdateState({
          status: "updating",
          phase: t("settings.host.daemon.update.phaseInstalling"),
        });
      else if (phase === "complete")
        setUpdateState({
          status: "updating",
          phase: t("settings.host.daemon.update.phaseComplete"),
        });
    });
    unsubscribeRef.current = unsubscribe;

    void daemonClient
      .updateDaemon(requestId)
      .then((response) => {
        unsubscribeRef.current = null;
        unsubscribe();
        if (!response.success) {
          if (!isMountedRef.current) return undefined;
          setUpdateState({
            status: "failed",
            title: t("settings.host.daemon.update.requestFailedTitle"),
            message: t("settings.host.daemon.update.requestFailedMessage", {
              error: response.error ?? "Unknown error",
            }),
          });
          return undefined;
        }
        // Update succeeded — wait for daemon to restart and reconnect
        void waitForDaemonRestart(startMarker);
        return undefined;
      })
      .catch((error) => {
        unsubscribeRef.current = null;
        unsubscribe();
        console.error(`[HostPage] Failed to update daemon ${host.label}`, error);
        if (!isMountedRef.current) return;
        setUpdateState({
          status: "failed",
          title: t("settings.host.daemon.update.requestFailedTitle"),
          message: t("settings.host.daemon.update.requestFailedMessage", {
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        });
      });
    return;
  }, [daemonClient, host.label, host.serverId, isHostConnected, runtime, t, waitForDaemonRestart]);

  const updateIcon = useMemo(
    () => <ArrowUpToLine size={theme.iconSize.sm} color={theme.colors.foreground} />,
    [theme.iconSize.sm, theme.colors.foreground],
  );

  const shouldShowUpdate = hasVersionMismatch && (supportsSelfUpdate || desktopManaged);
  if (!shouldShowUpdate) {
    return null;
  }

  const isUpdating = updateState.status === "updating";
  const buttonLabel = isUpdating ? updateState.phase : t("settings.host.daemon.update.confirm");

  return (
    <View style={settingsStyles.card} testID="host-page-update-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.daemon.update.title")}</Text>
          <Text style={settingsStyles.rowHint}>
            {desktopManaged
              ? t("settings.host.daemon.update.desktopManagedHint")
              : t("settings.host.daemon.update.hint")}
          </Text>
        </View>
        <Button
          variant="outline"
          size="sm"
          leftIcon={updateIcon}
          onPress={handleUpdate}
          disabled={desktopManaged || isUpdating || !daemonClient || !isConnected}
          testID="host-page-update-button"
        >
          {buttonLabel}
        </Button>
      </View>
      {updateState.status === "failed" ? (
        <View style={styles.updateFailure}>
          <InlineAlert
            variant="error"
            title={updateState.title}
            description={updateState.message}
            testID="host-page-update-error"
          />
        </View>
      ) : null}
    </View>
  );
}

function InjectFroggToolsCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({
        mcp: {
          injectIntoAgents: next,
        },
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-inject-mcp-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>
            {t("settings.host.orchestration.enableTools.title")}
          </Text>
          <Text style={settingsStyles.rowHint}>
            {t("settings.host.orchestration.enableTools.hint")}
          </Text>
        </View>
        <Switch
          value={config?.mcp.injectIntoAgents !== false}
          onValueChange={handleValueChange}
          accessibilityLabel={t("settings.host.orchestration.enableTools.accessibilityLabel")}
        />
      </View>
    </View>
  );
}

function AutoArchiveMergedWorkspacesCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ autoArchiveAfterMerge: next }).catch((error) => {
        console.error("[HostPage] Failed to update auto-archive after merge", error);
        Alert.alert(
          "Unable to update sessions",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-auto-archive-merged-workspaces-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Archive merged PR sessions</Text>
          <Text style={settingsStyles.rowHint}>
            Automatically archive clean {brand.name} workspaces after their pull request is merged
          </Text>
        </View>
        <Switch
          value={config?.autoArchiveAfterMerge === true}
          onValueChange={handleValueChange}
          accessibilityLabel="Archive merged PR workspaces"
          testID="host-page-auto-archive-merged-workspaces-switch"
        />
      </View>
    </View>
  );
}

function EnableTerminalAgentHooksCard({ serverId }: { serverId: string }) {
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);

  const handleValueChange = useCallback(
    (next: boolean) => {
      void patchConfig({ enableTerminalAgentHooks: next }).catch((error) => {
        console.error("[HostPage] Failed to update terminal agent hooks", error);
        Alert.alert(
          "Unable to update terminal agent hooks",
          error instanceof Error ? error.message : String(error),
        );
      });
    },
    [patchConfig],
  );

  if (!isConnected) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-terminal-agent-hooks-card">
      <View style={settingsStyles.row}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>Enable terminal agent hooks</Text>
          <Text style={settingsStyles.rowHint}>
            Get notifications and status from terminal agents. This installs hooks in your agent
            config files.
          </Text>
        </View>
        <Switch
          value={config?.enableTerminalAgentHooks === true}
          onValueChange={handleValueChange}
          accessibilityLabel="Enable terminal agent hooks"
          testID="host-page-terminal-agent-hooks-switch"
        />
      </View>
    </View>
  );
}

function AppendSystemPromptCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persistedPrompt = config?.appendSystemPrompt ?? "";
  const [draft, setDraft] = useState(persistedPrompt);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const header = useMemo<SheetHeader>(
    () => ({ title: t("settings.host.orchestration.systemPrompt.sheetTitle") }),
    [t],
  );

  useEffect(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  const hasChanges = draft !== persistedPrompt;

  const handleOpen = useCallback(() => {
    setDraft(persistedPrompt);
    setIsEditing(true);
  }, [persistedPrompt]);

  const handleClose = useCallback(() => {
    if (isSaving) return;
    setDraft(persistedPrompt);
    setIsEditing(false);
  }, [isSaving, persistedPrompt]);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    void patchConfig({ appendSystemPrompt: draft })
      .then(() => {
        setIsEditing(false);
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to save append system prompt", error);
      })
      .finally(() => setIsSaving(false));
  }, [draft, patchConfig]);

  const handleReset = useCallback(() => {
    setDraft(persistedPrompt);
  }, [persistedPrompt]);

  if (!isConnected) return null;

  return (
    <>
      <View style={settingsStyles.card} testID="host-page-append-system-prompt-card">
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.orchestration.systemPrompt.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.host.orchestration.systemPrompt.hint")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            onPress={handleOpen}
            testID="host-page-append-system-prompt-edit"
          >
            {t("settings.host.orchestration.systemPrompt.edit")}
          </Button>
        </View>
      </View>

      {isEditing ? (
        <AdaptiveModalSheet
          header={header}
          visible
          onClose={handleClose}
          testID="host-page-append-system-prompt-sheet"
          desktopMaxWidth={560}
        >
          <SettingsTextAreaCard
            testID="host-page-append-system-prompt-input"
            accessibilityLabel={t("settings.host.orchestration.systemPrompt.accessibilityLabel")}
            value={draft}
            onChangeText={setDraft}
            placeholder={t("settings.host.orchestration.systemPrompt.placeholder")}
          />
          <View style={styles.appendPromptActions}>
            <Button
              variant="ghost"
              size="sm"
              onPress={handleReset}
              disabled={!hasChanges || isSaving}
              testID="host-page-append-system-prompt-reset"
            >
              {t("settings.host.orchestration.systemPrompt.reset")}
            </Button>
            <Button
              variant="default"
              size="sm"
              onPress={handleSave}
              disabled={!hasChanges || isSaving}
              testID="host-page-append-system-prompt-save"
            >
              {isSaving
                ? t("settings.host.orchestration.systemPrompt.saving")
                : t("settings.host.orchestration.systemPrompt.save")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </>
  );
}

function RelayEndpointCard({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsEndpointConfig = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.relayEndpointConfig === true,
  );
  const { config, patchConfig } = useDaemonConfig(serverId);
  const persistedEndpoint = config?.relay?.endpoint ?? "";
  const persistedUseTls = config?.relay?.useTls !== false;
  const editable = config?.relay?.endpointMutable !== false;
  const [draft, setDraft] = useState(persistedEndpoint);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    setDraft(persistedEndpoint);
  }, [persistedEndpoint]);

  const hasChanges = draft.trim() !== persistedEndpoint;

  const save = useCallback(
    (patch: { endpoint?: string; useTls?: boolean }) => {
      setIsSaving(true);
      setSaveFailed(false);
      void patchConfig({ relay: patch })
        .catch((error) => {
          console.error("[HostPage] Failed to save relay endpoint", error);
          setSaveFailed(true);
        })
        .finally(() => setIsSaving(false));
    },
    [patchConfig],
  );
  const handleSave = useCallback(() => save({ endpoint: draft.trim() }), [draft, save]);
  const handleUseTlsChange = useCallback((next: boolean) => save({ useTls: next }), [save]);

  if (!isConnected || !supportsEndpointConfig || !config) return null;

  return (
    <View style={settingsStyles.card} testID="host-page-relay-endpoint-card">
      <View style={styles.relayEndpointBody}>
        <Field
          label={t("settings.host.relayEndpoint.title")}
          hint={
            editable
              ? t("settings.host.relayEndpoint.hint")
              : t("settings.host.relayEndpoint.overridden")
          }
          error={saveFailed ? t("settings.host.relayEndpoint.saveFailed") : null}
        >
          <FormTextInput
            initialValue={persistedEndpoint}
            resetKey={persistedEndpoint}
            onChangeText={setDraft}
            placeholder={t("settings.host.relayEndpoint.placeholder")}
            autoCapitalize="none"
            autoCorrect={false}
            editable={editable && !isSaving}
            accessibilityLabel={t("settings.host.relayEndpoint.accessibilityLabel")}
            testID="host-page-relay-endpoint-input"
          />
        </Field>
        <View style={styles.appendPromptActions}>
          <Button
            variant="default"
            size="sm"
            onPress={handleSave}
            disabled={!editable || !hasChanges || isSaving}
            testID="host-page-relay-endpoint-save"
          >
            {isSaving
              ? t("settings.host.relayEndpoint.saving")
              : t("settings.host.relayEndpoint.save")}
          </Button>
        </View>
      </View>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.relayEndpoint.useTls")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.relayEndpoint.useTlsHint")}</Text>
        </View>
        <Switch
          value={persistedUseTls}
          onValueChange={handleUseTlsChange}
          disabled={!editable || isSaving}
          accessibilityLabel={t("settings.host.relayEndpoint.useTls")}
          testID="host-page-relay-endpoint-tls-switch"
        />
      </View>
    </View>
  );
}

function PairDeviceRow({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpen = useCallback(() => setIsModalOpen(true), []);
  const handleClose = useCallback(() => setIsModalOpen(false), []);

  return (
    <View style={settingsStyles.card}>
      <Pressable
        style={settingsStyles.row}
        onPress={handleOpen}
        accessibilityRole="button"
        testID="host-page-pair-device-row"
      >
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("settings.host.pairDevices.rowTitle")}</Text>
          <Text style={settingsStyles.rowHint}>{t("settings.host.pairDevices.rowHint")}</Text>
        </View>
        <ChevronRight size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      </Pressable>

      <PairDeviceModal
        serverId={serverId}
        visible={isModalOpen}
        onClose={handleClose}
        testID="host-page-pair-device-card"
      />
    </View>
  );
}

function RemoveHostSection({
  host,
  isLocalDaemon,
  onRemoved,
}: {
  host: HostProfile;
  isLocalDaemon: boolean;
  onRemoved?: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const { removeHost } = useHostMutations();
  const { updateSettings } = useDesktopSettings();
  const { data: daemonStatusData, setStatus } = useDaemonStatus();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const daemonStatus = daemonStatusData?.status ?? null;
  const removeHostHeader = useMemo<SheetHeader>(
    () => ({
      title: isLocalDaemon
        ? t("settings.host.daemon.remove.localConfirmTitle")
        : t("settings.host.daemon.remove.title"),
    }),
    [isLocalDaemon, t],
  );

  const destructiveTextStyle = useMemo(
    () => ({ color: theme.colors.destructive }),
    [theme.colors.destructive],
  );

  const handleOpenConfirm = useCallback(() => setIsConfirming(true), []);
  const handleCloseConfirm = useCallback(() => {
    if (isRemoving) return;
    setIsConfirming(false);
  }, [isRemoving]);
  const handleCancel = useCallback(() => setIsConfirming(false), []);
  const rollbackLocalhostRemoval = useCallback(
    async (shouldRestartDaemon: boolean) => {
      await updateSettings({ daemon: { manageBuiltInDaemon: true } });
      if (!shouldRestartDaemon) {
        return;
      }
      setStatus(await startDesktopDaemon());
    },
    [setStatus, updateSettings],
  );
  const handleConfirmRemove = useCallback(() => {
    setIsRemoving(true);
    const remove = async () => {
      let didDisableDaemonManagement = false;
      let didStopDaemon = false;
      if (isLocalDaemon) {
        try {
          await updateSettings({ daemon: { manageBuiltInDaemon: false } });
          didDisableDaemonManagement = true;
          if (daemonStatus?.status === "running" && daemonStatus.desktopManaged) {
            setStatus(await stopDesktopDaemon("host_remove"));
            didStopDaemon = true;
          }
          await removeHost(host.serverId);
        } catch (error) {
          if (didDisableDaemonManagement) {
            try {
              await rollbackLocalhostRemoval(didStopDaemon);
            } catch (rollbackError) {
              console.error("[HostPage] Failed to roll back localhost removal", rollbackError);
            }
          }
          throw error;
        }
        return;
      }
      await removeHost(host.serverId);
    };
    void remove()
      .then(() => {
        setIsConfirming(false);
        onRemoved?.();
        return;
      })
      .catch((error) => {
        console.error("[HostPage] Failed to remove host", error);
        Alert.alert(
          t("settings.host.daemon.remove.errorTitle"),
          isLocalDaemon
            ? t("settings.host.daemon.remove.localErrorMessage")
            : t("settings.host.daemon.remove.errorMessage"),
        );
      })
      .finally(() => setIsRemoving(false));
  }, [
    daemonStatus,
    host.serverId,
    isLocalDaemon,
    onRemoved,
    removeHost,
    rollbackLocalhostRemoval,
    setStatus,
    t,
    updateSettings,
  ]);

  const removeIcon = useMemo(
    () => <Trash2 size={theme.iconSize.sm} color={theme.colors.destructive} />,
    [theme.iconSize.sm, theme.colors.destructive],
  );

  return (
    <SettingsSection
      title={t("settings.host.daemon.dangerZone")}
      testID="host-page-remove-host-card"
    >
      <RestartDaemonCard host={host} />

      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {isLocalDaemon
                ? t("settings.host.daemon.remove.localTitle")
                : t("settings.host.daemon.remove.title")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {isLocalDaemon
                ? t("settings.host.daemon.remove.localHint")
                : t("settings.host.daemon.remove.hint")}
            </Text>
          </View>
          <Button
            variant="outline"
            size="sm"
            leftIcon={removeIcon}
            textStyle={destructiveTextStyle}
            onPress={handleOpenConfirm}
            testID="host-page-remove-host-button"
          >
            {t("settings.host.connections.removeAction")}
          </Button>
        </View>
      </View>

      {isConfirming ? (
        <AdaptiveModalSheet
          header={removeHostHeader}
          visible
          onClose={handleCloseConfirm}
          testID="remove-host-confirm-modal"
        >
          <Text style={styles.confirmText}>
            {isLocalDaemon
              ? t("settings.host.daemon.remove.localConfirmMessage")
              : t("settings.host.daemon.remove.confirmMessage", {
                  name: host.label,
                })}
          </Text>
          <View style={styles.confirmActions}>
            <Button
              variant="secondary"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleCancel}
              disabled={isRemoving}
            >
              {t("common.actions.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              style={FLEX_1_STYLE}
              onPress={handleConfirmRemove}
              disabled={isRemoving}
              testID="remove-host-confirm"
            >
              {t("settings.host.connections.removeAction")}
            </Button>
          </View>
        </AdaptiveModalSheet>
      ) : null}
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Terminal Profiles
// ---------------------------------------------------------------------------

function generateProfileId(): string {
  return `profile_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function parseArgsString(raw: string): string[] | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMPTY_PROFILE_DRAFT: ProfileDraft = { name: "", command: "", args: "" };

interface TerminalProfileRowProps {
  profile: TerminalProfile;
  isFirst: boolean;
  isLast: boolean;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
}

function TerminalProfileRow({
  profile,
  isFirst,
  isLast,
  onEdit,
  onRemove,
  onMoveUp,
  onMoveDown,
}: TerminalProfileRowProps) {
  const { t } = useTranslation();

  const handleEdit = useCallback(() => onEdit(profile.id), [onEdit, profile.id]);
  const handleRemove = useCallback(() => onRemove(profile.id), [onRemove, profile.id]);
  const handleMoveUp = useCallback(() => onMoveUp(profile.id), [onMoveUp, profile.id]);
  const handleMoveDown = useCallback(() => onMoveDown(profile.id), [onMoveDown, profile.id]);

  const commandText =
    profile.args && profile.args.length > 0
      ? `${profile.command} ${profile.args.join(" ")}`
      : profile.command;

  const rowStyle = useMemo(
    () => [settingsStyles.row, !isFirst && settingsStyles.rowBorder, terminalProfileStyles.row],
    [isFirst],
  );

  const icon = getTerminalProfileIcon(profile);

  return (
    <View style={rowStyle} testID={`terminal-profile-row-${profile.id}`}>
      <View style={terminalProfileStyles.iconWrapper}>
        {icon ? (
          <ThemedDynamicProviderIcon
            iconKey={icon}
            size={ICON_SIZE.md}
            uniProps={mutedColorMapping}
          />
        ) : (
          <ThemedProfileSquareTerminal size={ICON_SIZE.md} uniProps={mutedColorMapping} />
        )}
      </View>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {profile.name}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {commandText}
        </Text>
      </View>
      <View style={terminalProfileStyles.rowActions}>
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveUpIcon}
          onPress={handleMoveUp}
          disabled={isFirst}
          accessibilityLabel={t("settings.host.terminalProfiles.moveUp")}
          testID={`terminal-profile-move-up-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={moveDownIcon}
          onPress={handleMoveDown}
          disabled={isLast}
          accessibilityLabel={t("settings.host.terminalProfiles.moveDown")}
          testID={`terminal-profile-move-down-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={editProfileIcon}
          onPress={handleEdit}
          accessibilityLabel={t("settings.host.terminalProfiles.editProfile")}
          testID={`terminal-profile-edit-${profile.id}`}
        />
        <Button
          variant="ghost"
          size="sm"
          leftIcon={removeProfileIcon}
          onPress={handleRemove}
          accessibilityLabel={t("settings.host.terminalProfiles.remove")}
          testID={`terminal-profile-remove-${profile.id}`}
        />
      </View>
    </View>
  );
}

function TerminalProfilesSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { config, patchConfig } = useDaemonConfig(serverId);
  const [editingProfile, setEditingProfile] = useState<{
    id: string;
    draft: ProfileDraft;
  } | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  // Settings edits what is persisted, not the adopted view. Any save here
  // writes the whole list back, so resolving first would bake read-time prompt
  // adoption into the user's config the first time they reorder a row.
  const profiles = useMemo(
    () => (config ? (config.terminalProfiles ?? DEFAULT_TERMINAL_PROFILES) : null),
    [config],
  );

  const saveProfiles = useCallback(
    async (next: TerminalProfile[]) => {
      await patchConfig({ terminalProfiles: next });
    },
    [patchConfig],
  );

  const handleAddOpen = useCallback(() => setIsAdding(true), []);
  const handleAddClose = useCallback(() => setIsAdding(false), []);

  const handleAddSave = useCallback(
    async (draft: ProfileDraft) => {
      const current = profiles ? [...profiles] : [];
      const next: TerminalProfile[] = [
        ...current,
        {
          id: generateProfileId(),
          name: draft.name,
          command: draft.command,
          args: parseArgsString(draft.args),
        },
      ];
      await saveProfiles(next);
      setIsAdding(false);
    },
    [profiles, saveProfiles],
  );

  const handleEditOpen = useCallback(
    (id: string) => {
      const profile = profiles?.find((p) => p.id === id);
      if (!profile) return;
      setEditingProfile({
        id,
        draft: {
          name: profile.name,
          command: profile.command,
          args: profile.args ? profile.args.join(" ") : "",
        },
      });
    },
    [profiles],
  );

  const handleEditClose = useCallback(() => setEditingProfile(null), []);

  const handleEditSave = useCallback(
    async (draft: ProfileDraft) => {
      if (!editingProfile || !profiles) return;
      const next: TerminalProfile[] = profiles.map((p) =>
        p.id === editingProfile.id
          ? {
              ...p,
              name: draft.name,
              command: draft.command,
              args: parseArgsString(draft.args),
            }
          : p,
      );
      await saveProfiles(next);
      setEditingProfile(null);
    },
    [editingProfile, profiles, saveProfiles],
  );

  const handleRemove = useCallback(
    (id: string) => {
      const profile = profiles?.find((p) => p.id === id);
      if (!profile) return;
      void confirmDialog({
        title: t("settings.host.terminalProfiles.removeConfirmTitle"),
        message: t("settings.host.terminalProfiles.removeConfirmMessage", {
          name: profile.name,
        }),
        confirmLabel: t("settings.host.terminalProfiles.remove"),
        cancelLabel: t("common.actions.cancel"),
        destructive: true,
      }).then(async (confirmed) => {
        if (!confirmed || !profiles) return;
        try {
          await saveProfiles(profiles.filter((p) => p.id !== id));
        } catch (error) {
          Alert.alert(
            t("common.errors.unableToSave"),
            error instanceof Error ? error.message : String(error),
          );
        }
        return;
      });
    },
    [profiles, saveProfiles, t],
  );

  const handleMoveUp = useCallback(
    async (id: string) => {
      if (!profiles) return;
      const index = profiles.findIndex((p) => p.id === id);
      if (index <= 0) return;
      const next = [...profiles];
      const [item] = next.splice(index, 1);
      next.splice(index - 1, 0, item);
      try {
        await saveProfiles(next);
      } catch (error) {
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [profiles, saveProfiles, t],
  );

  const handleMoveDown = useCallback(
    async (id: string) => {
      if (!profiles) return;
      const index = profiles.findIndex((p) => p.id === id);
      if (index < 0 || index >= profiles.length - 1) return;
      const next = [...profiles];
      const [item] = next.splice(index, 1);
      next.splice(index + 1, 0, item);
      try {
        await saveProfiles(next);
      } catch (error) {
        Alert.alert(
          t("common.errors.unableToSave"),
          error instanceof Error ? error.message : String(error),
        );
      }
    },
    [profiles, saveProfiles, t],
  );

  const addButton = useMemo(
    () => (
      <Button
        variant="ghost"
        size="sm"
        leftIcon={addProfileIcon}
        onPress={handleAddOpen}
        disabled={!isConnected || !profiles}
        testID="terminal-profiles-add-button"
      />
    ),
    [handleAddOpen, isConnected, profiles],
  );

  if (!isConnected) {
    return (
      <View style={settingsStyles.card} testID="terminal-profiles-unavailable">
        <View style={terminalProfileStyles.emptyCard}>
          <Text style={terminalProfileStyles.emptyText}>
            {t("settings.host.terminalProfiles.unavailable")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <>
      <SettingsSection
        title={t("settings.host.terminalProfiles.sectionTitle")}
        trailing={addButton}
        testID="terminal-profiles-section"
      >
        <View style={settingsStyles.card} testID="terminal-profiles-card">
          {profiles && profiles.length > 0 ? (
            profiles.map((profile, index) => (
              <TerminalProfileRow
                key={profile.id}
                profile={profile}
                isFirst={index === 0}
                isLast={index === profiles.length - 1}
                onEdit={handleEditOpen}
                onRemove={handleRemove}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))
          ) : (
            <View style={terminalProfileStyles.emptyCard}>
              <Text style={terminalProfileStyles.emptyText}>
                {t("settings.host.terminalProfiles.emptyState")}
              </Text>
            </View>
          )}
        </View>
      </SettingsSection>

      <TerminalProfileEditModal
        visible={isAdding}
        title={t("settings.host.terminalProfiles.addProfileTitle")}
        initialDraft={EMPTY_PROFILE_DRAFT}
        onClose={handleAddClose}
        onSave={handleAddSave}
        testID="terminal-profile-edit-modal"
      />

      {editingProfile ? (
        <TerminalProfileEditModal
          visible
          title={t("settings.host.terminalProfiles.editProfileTitle")}
          initialDraft={editingProfile.draft}
          onClose={handleEditClose}
          onSave={handleEditSave}
        />
      ) : null}
    </>
  );
}

export function HostTerminalsPage({ serverId }: { serverId: string }) {
  const host = useHostProfile(serverId);

  if (!host) {
    return <HostNotFound />;
  }

  return (
    <View>
      <SettingsSection title="Terminal agents">
        <EnableTerminalAgentHooksCard serverId={serverId} />
      </SettingsSection>
      <TerminalProfilesSection serverId={serverId} />
    </View>
  );
}

const terminalProfileStyles = StyleSheet.create((theme) => ({
  row: {
    gap: theme.spacing[2],
    minHeight: 56,
  },
  iconWrapper: {
    width: theme.iconSize.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));

const styles = StyleSheet.create((theme) => ({
  callerRoleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  updateFailure: {
    marginHorizontal: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  daemonHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginBottom: theme.spacing[4],
  },
  daemonHeaderLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  errorText: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[2],
  },
  connectionLatency: {
    fontSize: theme.fontSize.base,
    marginRight: theme.spacing[2],
  },
  confirmText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  confirmActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginTop: theme.spacing[4],
  },
  relayEndpointBody: {
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  appendPromptActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

const FLEX_1_STYLE = { flex: 1 };
