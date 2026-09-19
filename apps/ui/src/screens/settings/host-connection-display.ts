import type { TFunction } from "i18next";
import type { HostConnection } from "@/types/host-connection";

/** "TCP (192.168.1.17:9999)", "Relay (relay.example:443)" — the transport and where it dials. */
export function formatHostConnectionLabel(connection: HostConnection, t: TFunction): string {
  if (connection.type === "relay") {
    return `${t("settings.host.badges.relay")} (${connection.relayEndpoint})`;
  }
  if (connection.type === "directSocket" || connection.type === "directPipe") {
    return `${t("settings.host.badges.local")} (${connection.path})`;
  }
  if (connection.type === "remoteSsh") {
    return `${t("settings.host.badges.remoteSsh")} (${connection.host})`;
  }
  return `TCP (${connection.endpoint})`;
}

/**
 * The connections the host header names, in every connection state.
 *
 * Once the runtime has picked a connection — connecting to it, online over it, or failed on
 * it — that one. Before it has picked one (still probing, every probe timing out, or stopped)
 * it is dialling all of them, so all of them. The address must never drop out of the header
 * while the status beside it is the only thing that changed.
 */
export function resolveHeaderConnections(input: {
  activeConnectionId: string | null;
  connections: readonly HostConnection[];
}): readonly HostConnection[] {
  const { activeConnectionId, connections } = input;
  if (activeConnectionId) {
    const active = connections.find((connection) => connection.id === activeConnectionId);
    if (active) return [active];
  }
  return connections;
}
