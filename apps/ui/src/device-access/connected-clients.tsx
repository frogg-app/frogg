/**
 * COMPAT(connectedClients): added in v1.5.51.
 *
 * Everyone connected to one host right now — paired devices and loopback or
 * trusted-network clients alike — with where each of them is working. Any role
 * may look: seeing who else is in the room is what makes a shared daemon
 * workable, and it grants nothing.
 *
 * Nicknames are this device's private labels for the others. They are keyed by
 * the daemon's `clientKey`, never sent anywhere, and win over the name a client
 * gave itself everywhere presence names someone.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Check, Pencil, RotateCw, X } from "lucide-react-native";
import type { ConnectedClient, PresenceTarget } from "@frogg/protocol/device-access";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Field, FormTextInput as TextInput } from "@/components/ui/form-field";
import type { EditingTextInputHandle } from "@/components/ui/text-input";
import { useFetchQuery } from "@/data/query";
import { i18n } from "@/i18n/i18next";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { PresenceAvatar } from "@/presence/presence-bar";
import {
  DISPLAY_NAME_MAX_LENGTH,
  NICKNAME_MAX_LENGTH,
  resolveSelfDisplayName,
  usePresenceIdentityStore,
} from "@/presence/identity-store";
import { deviceAccessQueryRoot } from "./query-keys";
import { UNTRUSTED_NAME_DISPLAY_MAX, sanitizeUntrustedText } from "./untrusted-text";
import { resolveDeviceLabel } from "@/pairing/device-label";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const ThemedPencil = withUnistyles(Pencil);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Presence changes by the second; a settings page open on it should follow along. */
const CONNECTIONS_REFRESH_MS = 5_000;

export function connectionsQueryKey(serverId: string): readonly unknown[] {
  return [...deviceAccessQueryRoot(serverId), "connections"];
}

export function ConnectedClients({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const supported = useHostFeature(serverId, "connectedClients");
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);

  const query = useFetchQuery({
    queryKey: connectionsQueryKey(serverId),
    queryFn: async () => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.listConnections();
      if (payload.error) throw new Error(payload.error);
      return payload.connections;
    },
    enabled: supported && Boolean(client) && isConnected,
    dataShape: "list",
    staleTimeMs: CONNECTIONS_REFRESH_MS,
    refetchInterval: CONNECTIONS_REFRESH_MS,
    retry: 1,
  });
  const refetch = query.refetch;
  const handleRetry = useCallback(() => void refetch(), [refetch]);

  if (!supported) {
    return (
      <View style={styles.list}>
        <YourNameField />
        <Alert
          variant="info"
          description={t("deviceAccess.connections.unsupported")}
          testID="connections-unsupported"
        />
      </View>
    );
  }

  const connections = query.data ?? [];
  return (
    <View style={styles.list} testID="connections-list">
      <YourNameField />
      {query.isPending && query.fetchStatus !== "idle" ? (
        <View style={styles.center} testID="connections-loading">
          <ThemedLoadingSpinner size="small" uniProps={mutedColor} />
        </View>
      ) : null}
      {query.error && connections.length === 0 ? (
        <Alert variant="error" description={query.error.message} testID="connections-error">
          <Button variant="outline" size="sm" leftIcon={RotateCw} onPress={handleRetry}>
            {t("deviceAccess.actions.retry")}
          </Button>
        </Alert>
      ) : null}
      {connections.map((connection) => (
        <ConnectionRow key={connection.participantId} serverId={serverId} connection={connection} />
      ))}
      {query.isSuccess && connections.every((connection) => connection.isSelf) ? (
        <Text style={styles.meta} testID="connections-alone">
          {t("deviceAccess.connections.alone")}
        </Text>
      ) : null}
    </View>
  );
}

/** How this device appears to everyone else. Applied on the next presence heartbeat. */
function YourNameField() {
  const { t } = useTranslation();
  const displayName = usePresenceIdentityStore((state) => state.displayName);
  const setDisplayName = usePresenceIdentityStore((state) => state.setDisplayName);
  const draftRef = useRef(displayName);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 1500);
    return () => clearTimeout(timer);
  }, [saved]);

  const handleChange = useCallback((value: string) => {
    draftRef.current = value;
  }, []);
  const commit = useCallback(() => {
    if (draftRef.current.trim() === displayName) return;
    setDisplayName(draftRef.current);
    setSaved(true);
  }, [displayName, setDisplayName]);

  return (
    <View style={styles.yourName}>
      <Field
        label={t("deviceAccess.yourName.title")}
        hint={t("deviceAccess.yourName.description")}
        testID="connections-your-name"
      >
        <View style={styles.inlineRow}>
          <TextInput
            style={styles.input}
            size="sm"
            initialValue={displayName}
            placeholder={resolveDeviceLabel()}
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            onChangeText={handleChange}
            onSubmitEditing={commit}
            onBlur={commit}
            accessibilityLabel={t("deviceAccess.yourName.title")}
            testID="connections-your-name-input"
          />
          {saved ? <Check size={16} color="#10b981" testID="connections-your-name-saved" /> : null}
        </View>
      </Field>
    </View>
  );
}

function ConnectionRow({
  serverId,
  connection,
}: {
  serverId: string;
  connection: ConnectedClient;
}) {
  const { t } = useTranslation();
  const nickname = usePresenceIdentityStore((state) => state.nicknames[connection.clientKey] ?? "");
  const setNickname = usePresenceIdentityStore((state) => state.setNickname);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<EditingTextInputHandle>(null);
  const draftRef = useRef(nickname);

  const ownName = connection.isSelf
    ? resolveSelfDisplayName()
    : sanitizeUntrustedText(connection.deviceName, { max: UNTRUSTED_NAME_DISPLAY_MAX });
  const shownName = nickname || ownName || t("deviceAccess.connections.unnamed");
  const where = useTargetsLabel(serverId, connection.targets);

  const startEditing = useCallback(() => {
    draftRef.current = nickname;
    setEditing(true);
  }, [nickname]);
  const cancel = useCallback(() => setEditing(false), []);
  const save = useCallback(() => {
    setNickname(connection.clientKey, draftRef.current);
    setEditing(false);
  }, [connection.clientKey, setNickname]);
  const handleChange = useCallback((value: string) => {
    draftRef.current = value;
  }, []);

  const since = new Date(connection.connectedAt);
  const sinceLabel = Number.isNaN(since.getTime())
    ? null
    : t("deviceAccess.connections.since", {
        time: since.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });

  return (
    <View style={styles.row} testID={`connection-row-${connection.participantId}`}>
      <PresenceAvatar name={shownName} identity={connection.clientKey} size="md" />
      <View style={styles.body}>
        {editing ? (
          <View style={styles.inlineRow}>
            <TextInput
              ref={inputRef}
              style={styles.input}
              size="sm"
              initialValue={nickname}
              placeholder={ownName || t("deviceAccess.connections.nicknamePlaceholder")}
              maxLength={NICKNAME_MAX_LENGTH}
              autoFocus
              onChangeText={handleChange}
              onSubmitEditing={save}
              accessibilityLabel={t("deviceAccess.connections.setNickname")}
              testID="connection-nickname-input"
            />
            <Button variant="default" size="sm" leftIcon={Check} onPress={save}>
              {t("deviceAccess.actions.save")}
            </Button>
            <Button variant="ghost" size="sm" leftIcon={X} onPress={cancel}>
              {t("deviceAccess.actions.cancel")}
            </Button>
          </View>
        ) : (
          <View style={styles.inlineRow}>
            <Text style={styles.name} numberOfLines={1} testID="connection-name">
              {shownName}
            </Text>
            {connection.isSelf ? <Badge label={t("deviceAccess.connections.you")} /> : null}
            <Badge
              label={
                connection.paired
                  ? t("deviceAccess.connections.paired")
                  : t("deviceAccess.connections.unpaired")
              }
            />
            {connection.isSelf ? null : (
              <Pressable
                onPress={startEditing}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t("deviceAccess.connections.setNickname")}
                testID="connection-nickname-edit"
                style={styles.iconButton}
              >
                <ThemedPencil size={13} uniProps={mutedColor} />
              </Pressable>
            )}
          </View>
        )}
        {nickname && ownName && nickname !== ownName ? (
          <Text style={styles.meta} numberOfLines={1}>
            {t("deviceAccess.connections.goesBy", { name: ownName })}
          </Text>
        ) : null}
        <Text style={styles.meta} numberOfLines={2} testID="connection-where">
          {[where, sinceLabel].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </View>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

/**
 * "In Fix login flow, Terminal" — agent titles where this app knows them, a
 * count for everything else. A primitive, so the row only re-renders when the
 * sentence itself changes.
 */
function useTargetsLabel(serverId: string, targets: readonly PresenceTarget[]): string {
  const { t } = useTranslation();
  const titles = useSessionStore((state) => {
    const agents = state.sessions[serverId]?.agents;
    return targets
      .map((target) => {
        if (target.kind === "terminal") return t("deviceAccess.connections.terminal");
        const title = agents?.get(target.agentId)?.title?.trim();
        return title || t("deviceAccess.connections.agent");
      })
      .join(", ");
  });
  if (targets.length === 0) return t("deviceAccess.connections.notInSession");
  return t("deviceAccess.connections.workingIn", { where: titles });
}

const styles = StyleSheet.create((theme: Theme) => ({
  list: { gap: theme.spacing[2] },
  center: { alignItems: "center", paddingVertical: theme.spacing[4] },
  yourName: {
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[3],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    padding: theme.spacing[3],
  },
  body: { flex: 1, minWidth: 0, gap: theme.spacing[1] },
  inlineRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  input: { flex: 1 },
  name: { color: theme.colors.foreground, flexShrink: 1, fontSize: theme.fontSize.base },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  badge: {
    backgroundColor: theme.colors.surface2,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[0.5],
  },
  badgeText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  iconButton: { padding: 2, borderRadius: 4 },
}));
