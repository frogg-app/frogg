import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

export interface Host {
  id: string;
  name: string;
  /** host:port of the daemon's WebSocket listener. */
  endpoint: string;
  tls?: boolean;
  password?: string;
}

interface HostsState {
  hosts: Host[];
  activeId: string | null;
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
    useHosts.subscribe((s) => void AsyncStorage.setItem(KEY, JSON.stringify(s)));
  });

export const hostUrl = (h: Host) => `${h.tls ? "wss" : "ws"}://${h.endpoint}/ws`;

/** The host to connect to: the saved active one, else a first entry from the env/query default. */
export function activeHost(fallbackEndpoint: string): Host {
  const st = useHosts.getState();
  const found = st.hosts.find((h) => h.id === st.activeId) ?? st.hosts[0];
  if (found) return found;
  const host: Host = {
    id: `h_${Date.now().toString(36)}`,
    name: fallbackEndpoint.split(":")[0] ?? "host",
    endpoint: fallbackEndpoint,
  };
  useHosts.setState({ hosts: [host], activeId: host.id });
  return host;
}

export function addHost(input: Omit<Host, "id">): Host {
  const host = { ...input, id: `h_${Date.now().toString(36)}` };
  useHosts.setState((s) => ({ hosts: [...s.hosts, host] }));
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
