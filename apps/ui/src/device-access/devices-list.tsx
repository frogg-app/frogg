import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react-native";
import type { DeviceCredential, DeviceRole } from "@frogg/protocol/device-access";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import type { Theme } from "@/styles/theme";
import { leavesNoOwner } from "./capabilities";
import { DeviceRow } from "./device-row";
import { sanitizeUntrustedText } from "./untrusted-text";
import { useDeviceAccess } from "./use-device-access";
import { useDeviceMutations, useDevices } from "./use-devices";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedSpinner = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export interface DevicesListProps {
  serverId: string;
  /** Called after the device this session authenticated with is revoked. */
  onSelfRevoked?: () => void;
  testID?: string;
}

/**
 * The paired devices of one host. Read-only for an operator or a viewer; an
 * owner can rename, re-role and revoke. Revoking the device you are using is
 * allowed by the daemon and ends this session, so it is confirmed separately
 * and much more loudly.
 */
export function DevicesList({ serverId, onSelfRevoked, testID }: DevicesListProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const access = useDeviceAccess(serverId);
  const { devices, isLoading, isRefreshing, isStale, error, isEmpty, refetch } =
    useDevices(serverId);
  const mutations = useDeviceMutations(serverId);

  const refusal = useMemo(() => {
    if (access.canRevokeDevice) return null;
    if (!access.handshakeSeen) return t("deviceAccess.refusal.unknown");
    if (!access.devices) return t("deviceAccess.refusal.unsupported");
    return t("deviceAccess.refusal.role", {
      role: t(`deviceAccess.roles.${access.callerRole}.label`),
    });
  }, [access, t]);

  const handleRevoke = useCallback(
    async (device: DeviceCredential) => {
      const name = sanitizeUntrustedText(device.name, {
        fallback: t("deviceAccess.unnamedDevice"),
      });
      const lastOwner = leavesNoOwner(devices, { deviceId: device.id, nextRole: "revoked" });
      const confirmed = await confirmDialog({
        title: device.current
          ? t("deviceAccess.revoke.selfTitle")
          : t("deviceAccess.revoke.title", { name }),
        message: [
          device.current
            ? t("deviceAccess.revoke.selfMessage")
            : t("deviceAccess.revoke.message", { name }),
          lastOwner ? t("deviceAccess.revoke.lastOwnerWarning") : null,
        ]
          .filter((line): line is string => line !== null)
          .join("\n\n"),
        confirmLabel: t("deviceAccess.actions.revoke"),
        destructive: true,
      });
      if (!confirmed) return;
      try {
        const { revokedSelf } = await mutations.revoke(device.id);
        toast.show(t("deviceAccess.revoke.done", { name }), { variant: "success" });
        if (revokedSelf) onSelfRevoked?.();
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [devices, mutations, onSelfRevoked, t, toast],
  );

  const handleChangeRole = useCallback(
    async (device: DeviceCredential, role: DeviceRole) => {
      if (role === device.role) return;
      const name = sanitizeUntrustedText(device.name, {
        fallback: t("deviceAccess.unnamedDevice"),
      });
      if (leavesNoOwner(devices, { deviceId: device.id, nextRole: role })) {
        const confirmed = await confirmDialog({
          title: t("deviceAccess.role.lastOwnerTitle"),
          message: t("deviceAccess.role.lastOwnerMessage", { name }),
          confirmLabel: t("deviceAccess.role.change"),
          destructive: true,
        });
        if (!confirmed) return;
      }
      if (device.current && role !== "owner") {
        const confirmed = await confirmDialog({
          title: t("deviceAccess.role.selfDemoteTitle"),
          message: t("deviceAccess.role.selfDemoteMessage", {
            role: t(`deviceAccess.roles.${role}.label`),
          }),
          confirmLabel: t("deviceAccess.role.change"),
          destructive: true,
        });
        if (!confirmed) return;
      }
      try {
        await mutations.setRole({ deviceId: device.id, role });
        toast.show(
          t("deviceAccess.role.done", { name, role: t(`deviceAccess.roles.${role}.label`) }),
          { variant: "success" },
        );
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [devices, mutations, t, toast],
  );

  const handleRetry = useCallback(() => refetch(), [refetch]);

  if (!access.canViewDevices) {
    return (
      <Alert
        variant="info"
        description={
          access.handshakeSeen
            ? t("deviceAccess.refusal.unsupported")
            : t("deviceAccess.refusal.unknown")
        }
        testID="devices-unavailable"
      />
    );
  }

  if (isLoading) {
    return (
      <View style={styles.center} testID="devices-loading">
        <ThemedLoadingSpinner size="small" uniProps={mutedSpinner} />
        <Text style={styles.meta}>{t("deviceAccess.loading")}</Text>
      </View>
    );
  }

  if (error && devices.length === 0) {
    return (
      <Alert variant="error" description={error.message} testID="devices-error">
        <Button variant="outline" size="sm" leftIcon={RotateCw} onPress={handleRetry}>
          {t("deviceAccess.actions.retry")}
        </Button>
      </Alert>
    );
  }

  return (
    <View style={styles.list} testID={testID ?? "devices-list"}>
      {error ? (
        <Alert
          variant="warning"
          description={t("deviceAccess.staleAfterError")}
          testID="devices-stale"
        >
          <Button variant="outline" size="sm" leftIcon={RotateCw} onPress={handleRetry}>
            {t("deviceAccess.actions.retry")}
          </Button>
        </Alert>
      ) : null}
      {!error && isStale && !isRefreshing ? (
        <Text style={styles.meta} testID="devices-stale-note">
          {t("deviceAccess.staleSnapshot")}
        </Text>
      ) : null}
      {isEmpty ? (
        <Text style={styles.meta} testID="devices-empty">
          {t("deviceAccess.empty")}
        </Text>
      ) : null}
      {devices.map((device) => (
        <DeviceRowBinding
          key={device.id}
          device={device}
          canRename={access.canRenameDevice}
          canRevoke={access.canRevokeDevice}
          canChangeRole={access.canChangeRole}
          refusal={refusal}
          isPending={mutations.pendingDeviceId === device.id}
          onRenameDevice={mutations.rename}
          onRevokeDevice={handleRevoke}
          onChangeDeviceRole={handleChangeRole}
        />
      ))}
    </View>
  );
}

/** Binds one device to the row's parameterless callbacks. */
function DeviceRowBinding({
  device,
  onRenameDevice,
  onRevokeDevice,
  onChangeDeviceRole,
  ...rest
}: {
  device: DeviceCredential;
  canRename: boolean;
  canRevoke: boolean;
  canChangeRole: boolean;
  refusal: string | null;
  isPending: boolean;
  onRenameDevice: (input: { deviceId: string; name: string }) => Promise<void>;
  onRevokeDevice: (device: DeviceCredential) => void;
  onChangeDeviceRole: (device: DeviceCredential, role: DeviceRole) => void;
}) {
  const handleRename = useCallback(
    (name: string) => onRenameDevice({ deviceId: device.id, name }),
    [device.id, onRenameDevice],
  );
  const handleRevoke = useCallback(() => onRevokeDevice(device), [device, onRevokeDevice]);
  const handleChangeRole = useCallback(
    (role: DeviceRole) => onChangeDeviceRole(device, role),
    [device, onChangeDeviceRole],
  );
  return (
    <DeviceRow
      {...rest}
      device={device}
      onRename={handleRename}
      onRevoke={handleRevoke}
      onChangeRole={handleChangeRole}
      testID={`device-row-${device.id}`}
    />
  );
}

const styles = StyleSheet.create((theme: Theme) => ({
  list: { gap: theme.spacing[2] },
  center: { alignItems: "center", gap: theme.spacing[2], paddingVertical: theme.spacing[6] },
  meta: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
