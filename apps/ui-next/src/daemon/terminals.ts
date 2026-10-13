import { create } from "zustand";
import { getClient, onHostSwitch } from "./store";

export interface TerminalInfo {
  id: string;
  name: string;
  title?: string;
  activity?: unknown;
}

interface TermState {
  /** The checkout new terminals start in (the open session's). */
  cwd: string | null;
  /** Terminals per checkout this client watches, kept live through `terminals_changed`. */
  groups: Record<string, TerminalInfo[]>;
  /** Every terminal on the host, including ones in checkouts no session points at. */
  all: TerminalInfo[] | null;
  error: string | null;
}

export const useTerminals = create<TermState>(() => ({
  cwd: null,
  groups: {},
  all: null,
  error: null,
}));

const watched = new Set<string>();
let unsub: (() => void) | null = null;
let generation = 0;
onHostSwitch(() => {
  watched.clear();
  unsub?.();
  unsub = null;
  generation += 1;
  useTerminals.setState({ cwd: null, groups: {}, all: null, error: null });
});

const setGroup = (cwd: string, list: TerminalInfo[]) =>
  useTerminals.setState((s) => ({ groups: { ...s.groups, [cwd]: list } }));

async function refreshAll(): Promise<void> {
  const c = getClient();
  if (!c) return;
  const mine = generation;
  const res = await c.listTerminals();
  if (mine === generation) useTerminals.setState({ all: res.terminals });
}

/**
 * Watches the terminals of every given checkout (the open session's first) plus the host-wide
 * list, so a terminal stays visible whichever session or checkout is selected.
 */
export async function watchTerminals(cwds: string[], active: string | null): Promise<void> {
  const c = getClient();
  if (!c) return;
  useTerminals.setState({ cwd: active });
  unsub ??= c.subscribeRawMessages((m) => {
    if (m.type !== "terminals_changed" || !watched.has(m.payload.cwd)) return;
    setGroup(m.payload.cwd, m.payload.terminals);
    void refreshAll().catch(() => undefined);
  });
  const fresh = cwds.filter((cwd) => !watched.has(cwd));
  for (const cwd of fresh) {
    watched.add(cwd);
    c.subscribeTerminals({ cwd });
  }
  const mine = generation;
  await Promise.all([
    refreshAll(),
    ...fresh.map(async (cwd) => {
      const res = await c.listTerminals(cwd);
      if (mine === generation) setGroup(cwd, res.terminals);
    }),
  ]);
}

/** Starts a terminal in `cwd` (default: the open session's checkout). */
export async function newTerminal(cwd?: string): Promise<string | null> {
  const dir = cwd ?? useTerminals.getState().cwd;
  const client = getClient();
  if (!dir || !client) return null;
  const res = await client.createTerminal(dir);
  if (res.error || !res.terminal) {
    useTerminals.setState({ error: res.error ?? "could not start a terminal" });
    return null;
  }
  const t = res.terminal;
  const add = (list: TerminalInfo[] | null | undefined) =>
    list?.some((x) => x.id === t.id) ? list : [...(list ?? []), t];
  useTerminals.setState((s) => ({
    groups: { ...s.groups, [dir]: add(s.groups[dir]) },
    all: add(s.all),
  }));
  return t.id;
}

export async function killTerminal(id: string): Promise<void> {
  await getClient()?.killTerminal(id);
  useTerminals.setState((s) => ({
    groups: Object.fromEntries(
      Object.entries(s.groups).map(([cwd, list]) => [cwd, list.filter((t) => t.id !== id)]),
    ),
    all: s.all?.filter((t) => t.id !== id) ?? null,
  }));
}
