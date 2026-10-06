import AsyncStorage from "@react-native-async-storage/async-storage";
import type {
  DaemonClientConfig,
  DaemonClientErrorInfo,
} from "@frogg/client/internal/daemon-client";
import {
  buildRelayWebSocketUrl,
  shouldUseTlsForDefaultHostedRelay,
} from "@frogg/protocol/daemon-endpoints";
import { create } from "zustand";

export interface Host {
  id: string;
  name: string;
  /** host:port of the daemon's WebSocket listener, or of the relay for a relay host. */
  endpoint: string;
  tls?: boolean;
  /** Daemon password or the device credential minted by pairing. */
  password?: string;
  /** The daemon's stable id; a handshake from any other daemon is refused. */
  serverId?: string;
  /** Present when the host is reached through a relay, end-to-end encrypted to this key. */
  relay?: { daemonPublicKeyB64: string };
  /** `sha256:…` of the daemon key, kept so a later pairing can't swap keys silently. */
  fingerprint?: string;
  /** Role the daemon granted when this device paired. */
  role?: string;
  /** ISO time this device last had a live connection to the host. */
  lastOnlineAt?: string;
}

interface HostsState {
  hosts: Host[];
  activeId: string | null;
}

const newHostId = () => `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

/** Direct LAN/tailnet listener, including bracketed IPv6; paths and credentials are not addresses. */
export function parseHostAddress(input: string): { endpoint: string; name: string } | null {
  const raw = input.trim();
  if (!/^(?:[a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\]):\d{1,5}$/.test(raw)) return null;
  try {
    const port = Number(raw.slice(raw.lastIndexOf(":") + 1));
    if (port < 1 || port > 65535) return null;
    const url = new URL(`ws://${raw}`);
    return { endpoint: `${url.hostname}:${port}`, name: url.hostname };
  } catch {
    return null;
  }
}

const KEY = "frogg-next.hosts.v1";

export const useHosts = create<HostsState>(() => ({ hosts: [], activeId: null }));

/** Resolves once the saved hosts are loaded; later changes are written back. */
export const hostsReady: Promise<void> = AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) useHosts.setState(JSON.parse(raw) as HostsState);
    return undefined;
  })
  .catch(() => undefined /* corrupt or unavailable: start fresh */)
  .finally(() => {
    useHosts.subscribe(
      (s) => void AsyncStorage.setItem(KEY, JSON.stringify(s)).catch(() => undefined),
    );
  });

export const hostUrl = (h: Host) =>
  h.relay && h.serverId
    ? buildRelayWebSocketUrl({
        endpoint: h.endpoint,
        useTls: h.tls ?? shouldUseTlsForDefaultHostedRelay(h.endpoint),
        serverId: h.serverId,
        role: "client",
      })
    : `${h.tls ? "wss" : "ws"}://${h.endpoint}/ws`;

/** Extra DaemonClient options a host needs: relay E2EE and the serverId pin. */
export function hostClientOptions(h: Host): Partial<DaemonClientConfig> {
  return {
    ...(h.serverId ? { expectedServerId: h.serverId } : {}),
    ...(h.relay ? { e2ee: { enabled: true, daemonPublicKeyB64: h.relay.daemonPublicKeyB64 } } : {}),
  };
}

export const isRelayHost = (h: Host) => Boolean(h.relay);

/** The host to connect to: the saved active one, else a first entry from the env/query default. */
export function activeHost(fallbackEndpoint: string): Host {
  const st = useHosts.getState();
  const found = st.hosts.find((h) => h.id === st.activeId) ?? st.hosts[0];
  if (found) return found;
  const host: Host = {
    id: newHostId(),
    name: fallbackEndpoint.split(":")[0] ?? "host",
    endpoint: fallbackEndpoint,
  };
  useHosts.setState({ hosts: [host], activeId: host.id });
  return host;
}

export function addHost(input: Omit<Host, "id">): Host {
  const host = { ...input, id: newHostId() };
  useHosts.setState((s) => ({ hosts: [...s.hosts, host] }));
  return host;
}

/** Adds a paired host, or refreshes the saved one with the same serverId (re-pairing). */
export function upsertHost(input: Omit<Host, "id">): Host {
  const existing = input.serverId
    ? useHosts.getState().hosts.find((h) => h.serverId === input.serverId)
    : undefined;
  if (!existing) return addHost(input);
  const host = { ...existing, ...input, id: existing.id };
  useHosts.setState((s) => ({ hosts: s.hosts.map((h) => (h.id === host.id ? host : h)) }));
  return host;
}

export function removeHost(id: string): void {
  useHosts.setState((s) => ({
    hosts: s.hosts.filter((h) => h.id !== id),
    activeId: s.activeId === id ? null : s.activeId,
  }));
}

export function renameHost(id: string, name: string): void {
  useHosts.setState((s) => ({
    hosts: s.hosts.map((h) => (h.id === id ? { ...h, name } : h)),
  }));
}

// ---------------------------------------------------------------------------
// Live connection detail for the active host (the DaemonClient owns the backoff).

export interface HostLink {
  hostId: string | null;
  /** Reconnect attempt number while connecting; 0 on the first try. */
  attempt: number;
  /** Close reason from the last drop, if any. */
  reason: string | null;
  /** Typed error from the client (auth refused, wrong daemon, …). */
  error: DaemonClientErrorInfo | null;
  /** When the active host was last seen online in this run. */
  droppedAt: string | null;
}

export const useHostLink = create<HostLink>(() => ({
  hostId: null,
  attempt: 0,
  reason: null,
  error: null,
  droppedAt: null,
}));

type Status =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "connected" }
  | { status: "disconnected"; reason?: string }
  | { status: "disposed" };

/** Called by the store on every connection status change of the active client. */
export function noteConnStatus(
  hostId: string,
  s: Status,
  error: DaemonClientErrorInfo | null,
): void {
  const prev = useHostLink.getState();
  const fresh = prev.hostId !== hostId;
  if (s.status === "connected") {
    useHostLink.setState({ hostId, attempt: 0, reason: null, error: null, droppedAt: null });
    useHosts.setState((st) => ({
      hosts: st.hosts.map((h) =>
        h.id === hostId ? { ...h, lastOnlineAt: new Date().toISOString() } : h,
      ),
    }));
    return;
  }
  const base = fresh ? { attempt: 0, reason: null, droppedAt: null } : prev;
  const next: HostLink = {
    hostId,
    attempt: base.attempt,
    reason: base.reason,
    error,
    droppedAt: base.droppedAt,
  };
  if (s.status === "connecting") next.attempt = s.attempt;
  if (s.status === "disconnected") {
    next.reason = s.reason ?? null;
    next.droppedAt ??= new Date().toISOString();
  }
  useHostLink.setState(next);
}
