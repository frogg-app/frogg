import { Globe, Monitor } from "lucide-react-native";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { formatConnectionStatus, getConnectionStatusTone } from "@/utils/daemons";
import { formatHostConnectionLabel, resolveHeaderConnections } from "./host-connection-display";

const ThemedGlobe = withUnistyles(Globe);
const ThemedMonitor = withUnistyles(Monitor);
const badgeIconProps = (theme: Theme) => ({
  size: theme.iconSize.sm,
  color: theme.colors.foregroundMuted,
});

function ConnectionBadgeIcon({ type }: { type: HostConnection["type"] }) {
  const Icon = type === "relay" || type === "remoteSsh" ? ThemedGlobe : ThemedMonitor;
  return <Icon uniProps={badgeIconProps} />;
}

function formatDaemonVersionBadge(version: string | null): string | null {
  const trimmed = version?.trim();
  if (!trimmed) return null;
  return trimmed.startsWith("v") ? trimmed : `v${trimmed}`;
}

export function HostStatusBadges({ host }: { host: HostProfile }) {
  const serverId = host.serverId;
  const { t } = useTranslation();
  const snapshot = useHostRuntimeSnapshot(serverId);
  const daemonVersion = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.version ?? null,
  );

  const remoteBrand = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.brand?.name ?? null,
  );

  const connectionStatus = snapshot?.connectionStatus ?? "connecting";
  const activeConnectionId = snapshot?.activeConnectionId ?? null;
  const statusLabel = formatConnectionStatus(connectionStatus);
  const statusTone = getConnectionStatusTone(connectionStatus);
  let statusVariant: StatusBadgeVariant = "muted";
  let statusDotToneStyle = styles.statusDotMuted;
  if (statusTone === "success") {
    statusVariant = "success";
    statusDotToneStyle = styles.statusDotSuccess;
  } else if (statusTone === "warning") {
    statusVariant = "warning";
    statusDotToneStyle = styles.statusDotWarning;
  } else if (statusTone === "error") {
    statusVariant = "error";
    statusDotToneStyle = styles.statusDotDanger;
  }
  // The dialled address stays put through connecting, online, timeout and error; only the
  // status badge beside it changes.
  const headerConnections = resolveHeaderConnections({
    activeConnectionId,
    connections: host.connections,
  });
  const versionBadgeText = formatDaemonVersionBadge(daemonVersion);
  const statusDotStyle = useMemo(
    () => [styles.statusDot, statusDotToneStyle],
    [statusDotToneStyle],
  );
  const statusLeading = useMemo(() => <View style={statusDotStyle} />, [statusDotStyle]);

  return (
    <View style={styles.identityBadges} testID="host-page-identity">
      {remoteBrand ? <StatusBadge label={remoteBrand} variant="muted" /> : null}
      <StatusBadge label={statusLabel} variant={statusVariant} leading={statusLeading} />
      {headerConnections.map((connection) => (
        <View
          key={connection.id}
          style={styles.badgePill}
          testID={`host-page-header-connection-${connection.id}`}
        >
          <ConnectionBadgeIcon type={connection.type} />
          <Text style={styles.badgeText} numberOfLines={1}>
            {formatHostConnectionLabel(connection, t)}
          </Text>
        </View>
      ))}
      {versionBadgeText ? (
        <View style={styles.badgePill}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {versionBadgeText}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  identityBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexWrap: "wrap",
    marginBottom: theme.spacing[6],
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
  },
  statusDotMuted: { backgroundColor: theme.colors.foregroundMuted },
  statusDotSuccess: { backgroundColor: theme.colors.statusDotSuccess },
  statusDotWarning: { backgroundColor: theme.colors.statusDotWarning },
  statusDotDanger: { backgroundColor: theme.colors.statusDotDanger },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface3,
    maxWidth: 240,
  },
  badgeText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
}));
