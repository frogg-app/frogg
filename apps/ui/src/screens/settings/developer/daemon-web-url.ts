import { connectionNetworkHost } from "@/hosts/daemon-conflicts";
import type { HostProfile } from "@/types/host-connection";

/**
 * The web UI of another daemon on the same machine as `host`, at `port`. Null when the host is
 * only reachable through a relay or a local socket, so there is no address to open.
 */
export function siblingDaemonWebUrl(host: HostProfile, port: number): string | null {
  const connection =
    host.connections.find((candidate) => candidate.id === host.preferredConnectionId) ??
    host.connections[0];
  const machine = connection ? connectionNetworkHost(connection) : null;
  if (!machine) return null;
  return `http://${machine.includes(":") ? `[${machine}]` : machine}:${port}`;
}
