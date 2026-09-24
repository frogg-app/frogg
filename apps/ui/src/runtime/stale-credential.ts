import type { DaemonClientErrorInfo } from "@frogg/client/internal/daemon-client";
import type { HostProfile } from "@/types/host-connection";

/**
 * True when the daemon refused the credential this client presented (WS close
 * 4401, not rate-limited). The stored credential is stale and must be dropped
 * so the host asks for a new pairing instead of retrying a dead token.
 */
export function isStaleCredentialError(info: DaemonClientErrorInfo | null | undefined): boolean {
  return info?.code === "pairing_required" && info.credentialRejected;
}

/**
 * The host with the stored daemon credential removed from one connection, or
 * null when that connection carries none (nothing to clear).
 */
export function withoutConnectionCredential(
  host: HostProfile,
  connectionId: string,
): HostProfile | null {
  let changed = false;
  const connections = host.connections.map((connection) => {
    if (connection.id !== connectionId) return connection;
    if (connection.type !== "directTcp" && connection.type !== "remoteSsh") return connection;
    if (connection.password === undefined) return connection;
    changed = true;
    const { password: _dropped, ...rest } = connection;
    return rest;
  });
  return changed ? { ...host, connections } : null;
}
