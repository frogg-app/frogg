/**
 * Listen targets and connect targets are not the same string.
 *
 * A daemon binds a *wildcard* address to accept traffic on every interface, and
 * reports that bind address verbatim (`0.0.0.0:9999`, `:::9999`, `[::]:9999`).
 * A wildcard address is not a destination: you cannot connect to `::`. Handing
 * the raw listen string to a client makes a perfectly healthy daemon look
 * unresponsive — and it only shows on IPv6, because connecting to `0.0.0.0`
 * happens to work on Linux while connecting to `::` does not.
 *
 * So every connect path normalises first: each wildcard maps to its own
 * family's loopback (`0.0.0.0` -> `127.0.0.1`, `::`/`:::` -> `[::1]`), and
 * anything already addressable — an explicit host, a unix socket path, a named
 * pipe — is left exactly as it is. `deploy/install.sh` does the same mapping
 * inline for its post-install health check.
 */

const UNIX_SOCKET_PREFIXES = ["/", "unix://", "pipe://", "\\\\.\\pipe\\"];
const WILDCARD_V4 = "0.0.0.0";
const WILDCARD_V6 = "::";

/** True for a listen target that names a filesystem socket or Windows pipe rather than a TCP endpoint. */
export function isNonTcpListenTarget(listen: string): boolean {
  const normalized = listen.trim();
  if (!normalized) return false;
  return (
    UNIX_SOCKET_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    /^[A-Za-z]:[/\\]/.test(normalized)
  );
}

/**
 * Turns a daemon listen target into something a client can connect to.
 *
 * Returns `null` only for an empty target. Unix sockets, named pipes and
 * explicit hosts come back unchanged; a bare port becomes loopback; wildcard
 * binds become the matching loopback address.
 */
export function normalizeListenTargetForConnect(listen: string): string | null {
  const trimmed = listen.trim();
  if (!trimmed) return null;
  if (isNonTcpListenTarget(trimmed)) return trimmed;

  const scheme = trimmed.startsWith("tcp://") ? "tcp://" : "";
  const address = scheme ? trimmed.slice(scheme.length) : trimmed;

  if (/^\d+$/.test(address)) return `${scheme}127.0.0.1:${address}`;

  const lastColon = address.lastIndexOf(":");
  if (lastColon === -1) return trimmed;
  const port = address.slice(lastColon + 1);
  // An unbracketed IPv6 wildcard (`:::9999`) leaves `::` here; `[::]` leaves `[::]`.
  const rawHost = address.slice(0, lastColon).replace(/^\[|\]$/g, "");

  if (rawHost === "" || rawHost === WILDCARD_V4) return `${scheme}127.0.0.1:${port}`;
  if (rawHost === WILDCARD_V6) return `${scheme}[::1]:${port}`;
  return trimmed;
}

/**
 * The TCP endpoint a listen target names, exactly as written, or `null` when
 * the daemon is not on TCP (unix socket, named pipe). Callers that need to
 * *inspect* the bind address — to spot a wildcard and enumerate LAN addresses,
 * say — want this. Callers that need to *connect* want
 * `resolveConnectableTcpHost`.
 */
export function resolveTcpHostFromListen(listen: string): string | null {
  const normalized = listen.trim();
  if (!normalized || isNonTcpListenTarget(normalized)) return null;
  if (/^\d+$/.test(normalized)) return `127.0.0.1:${normalized}`;
  if (normalized.includes(":")) return normalized;
  return null;
}

/**
 * The TCP host to dial for a listen target: `resolveTcpHostFromListen` with
 * wildcard binds mapped to loopback. `null` when there is no TCP endpoint.
 */
export function resolveConnectableTcpHost(listen: string): string | null {
  const host = resolveTcpHostFromListen(listen);
  return host === null ? null : normalizeListenTargetForConnect(host);
}
