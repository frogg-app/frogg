import { useCallback, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DeviceCredential, DeviceRole } from "@frogg/protocol/device-access";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { i18n } from "@/i18n/i18next";
import { devicesQueryKey } from "./query-keys";
import { useDeviceAccess } from "./use-device-access";

/** Long enough that the list is not refetched on every tab switch. */
const DEVICES_STALE_MS = 30_000;

export interface DevicesView {
  devices: readonly DeviceCredential[];
  /** No snapshot yet. */
  isLoading: boolean;
  /** A snapshot is showing while a newer one is in flight. */
  isRefreshing: boolean;
  /** The daemon answered with a snapshot that is now older than its stale time. */
  isStale: boolean;
  /** The list could not be read. The last good snapshot, if any, stays visible. */
  error: Error | null;
  /** The daemon has no device list to show, as opposed to failing to send one. */
  isEmpty: boolean;
  refetch: () => void;
}

/**
 * The paired devices of one host. Separate from the mutations so a read-only
 * role can render the list without pulling the management code in with it.
 */
export function useDevices(serverId: string): DevicesView {
  const client = useHostRuntimeClient(serverId);
  const snapshot = useHostRuntimeSnapshot(serverId);
  const isConnected = snapshot?.connectionStatus === "online";
  const access = useDeviceAccess(serverId);

  const query = useFetchQuery({
    queryKey: devicesQueryKey(serverId),
    queryFn: async () => {
      if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      const payload = await client.listDevices();
      if (payload.error) throw new Error(payload.error);
      return payload.devices;
    },
    enabled: access.canViewDevices && Boolean(client) && isConnected,
    dataShape: "list",
    staleTimeMs: DEVICES_STALE_MS,
    retry: 1,
  });

  const refetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return useMemo(
    () => ({
      devices: query.data ?? [],
      isLoading: query.isPending && query.fetchStatus !== "idle",
      isRefreshing: query.isFetching && query.data !== undefined,
      isStale: query.isStale && query.data !== undefined,
      error: query.error,
      isEmpty: query.data !== undefined && query.data.length === 0,
      refetch,
    }),
    [
      query.data,
      query.error,
      query.fetchStatus,
      query.isFetching,
      query.isPending,
      query.isStale,
      refetch,
    ],
  );
}

export interface DeviceMutations {
  rename: (input: { deviceId: string; name: string }) => Promise<void>;
  revoke: (deviceId: string) => Promise<{ revokedSelf: boolean }>;
  setRole: (input: { deviceId: string; role: DeviceRole }) => Promise<void>;
  pendingDeviceId: string | null;
  isRenaming: boolean;
  isRevoking: boolean;
  isSettingRole: boolean;
}

/**
 * Owner-only device edits. Each writes the daemon's answer straight back into
 * the cache rather than invalidating, so a rename does not make the row blink
 * through a loading state it does not need.
 */
export function useDeviceMutations(serverId: string): DeviceMutations {
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => devicesQueryKey(serverId), [serverId]);

  const replaceDevice = useCallback(
    (device: DeviceCredential) => {
      queryClient.setQueryData<DeviceCredential[]>(queryKey, (previous) =>
        previous?.map((entry) => (entry.id === device.id ? device : entry)),
      );
    },
    [queryClient, queryKey],
  );

  const requireClient = useCallback(() => {
    if (!client) throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
    return client;
  }, [client]);

  const rename = useMutation({
    mutationFn: async (input: { deviceId: string; name: string }) => {
      const payload = await requireClient().renameDevice(input);
      if (payload.error) throw new Error(payload.error);
      if (!payload.device) throw new Error(i18n.t("deviceAccess.errors.unknownDevice"));
      return payload.device;
    },
    onSuccess: replaceDevice,
  });

  const revoke = useMutation({
    mutationFn: async (deviceId: string) => {
      const devices = queryClient.getQueryData<DeviceCredential[]>(queryKey) ?? [];
      const revokedSelf = devices.some((device) => device.id === deviceId && device.current);
      const payload = await requireClient().revokeDevice(deviceId);
      if (payload.error) throw new Error(payload.error);
      if (!payload.revoked) throw new Error(i18n.t("deviceAccess.errors.unknownDevice"));
      return { deviceId, revokedSelf };
    },
    onSuccess: ({ deviceId }) => {
      queryClient.setQueryData<DeviceCredential[]>(queryKey, (previous) =>
        previous?.filter((entry) => entry.id !== deviceId),
      );
    },
  });

  const setRole = useMutation({
    mutationFn: async (input: { deviceId: string; role: DeviceRole }) => {
      const payload = await requireClient().setDeviceRole({
        credentialId: input.deviceId,
        role: input.role,
      });
      if (payload.error) throw new Error(payload.error);
      return input;
    },
    onSuccess: ({ deviceId, role }) => {
      queryClient.setQueryData<DeviceCredential[]>(queryKey, (previous) =>
        previous?.map((entry) => (entry.id === deviceId ? { ...entry, role } : entry)),
      );
    },
  });

  const pendingDeviceId =
    (rename.isPending ? rename.variables?.deviceId : null) ??
    (revoke.isPending ? revoke.variables : null) ??
    (setRole.isPending ? setRole.variables?.deviceId : null) ??
    null;

  return useMemo(
    () => ({
      rename: async (input) => {
        await rename.mutateAsync(input);
      },
      revoke: async (deviceId) => {
        const result = await revoke.mutateAsync(deviceId);
        return { revokedSelf: result.revokedSelf };
      },
      setRole: async (input) => {
        await setRole.mutateAsync(input);
      },
      pendingDeviceId,
      isRenaming: rename.isPending,
      isRevoking: revoke.isPending,
      isSettingRole: setRole.isPending,
    }),
    [pendingDeviceId, rename, revoke, setRole],
  );
}
