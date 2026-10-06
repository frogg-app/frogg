import { create } from "zustand";
import { getClient, onHostSwitch } from "./store";

export interface TerminalInfo {
  id: string;
  name: string;
  title?: string;
  activity?: unknown;
}

interface TermState {
  cwd: string | null;
  list: TerminalInfo[] | null;
  error: string | null;
}

export const useTerminals = create<TermState>(() => ({
  cwd: null,
  list: null,
  error: null,
}));

let watching: string | null = null;
let unsub: (() => void) | null = null;
onHostSwitch(() => {
  watching = null;
  unsub = null;
  useTerminals.setState({ cwd: null, list: null, error: null });
});

export async function watchTerminals(cwd: string): Promise<void> {
  const client = getClient();
  if (!client || watching === cwd) return;
  if (watching) client.unsubscribeTerminals({ cwd: watching });
  watching = cwd;
  useTerminals.setState({ cwd, list: null });
  unsub ??= client.subscribeRawMessages((m) => {
    if (m.type === "terminals_changed" && m.payload.cwd === watching)
      useTerminals.setState({ list: m.payload.terminals });
  });
  client.subscribeTerminals({ cwd });
  const res = await client.listTerminals(cwd);
  useTerminals.setState({ list: res.terminals });
}

export async function newTerminal(): Promise<string | null> {
  const { cwd } = useTerminals.getState();
  const client = getClient();
  if (!cwd || !client) return null;
  const res = await client.createTerminal(cwd);
  if (res.error || !res.terminal) {
    useTerminals.setState({ error: res.error ?? "could not start a terminal" });
    return null;
  }
  const t = res.terminal;
  useTerminals.setState((s) => ({
    list: s.list?.some((x) => x.id === t.id) ? s.list : [...(s.list ?? []), t],
  }));
  return t.id;
}

export async function killTerminal(id: string): Promise<void> {
  await getClient()?.killTerminal(id);
  useTerminals.setState((s) => ({
    list: s.list?.filter((t) => t.id !== id) ?? null,
  }));
}
