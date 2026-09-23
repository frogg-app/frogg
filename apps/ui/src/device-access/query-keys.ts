/** Query keys for the device-access surfaces, one root per host. */
export function deviceAccessQueryRoot(serverId: string): readonly unknown[] {
  return ["device-access", serverId];
}

export function devicesQueryKey(serverId: string): readonly unknown[] {
  return [...deviceAccessQueryRoot(serverId), "devices"];
}

export function pairingRequestsQueryKey(serverId: string): readonly unknown[] {
  return [...deviceAccessQueryRoot(serverId), "pairing-requests"];
}

export function authSettingsQueryKey(serverId: string): readonly unknown[] {
  return [...deviceAccessQueryRoot(serverId), "auth-settings"];
}
