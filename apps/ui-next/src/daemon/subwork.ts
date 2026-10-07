// Live sub-work: provider subagents, workspace scripts, terminals, child sessions and background
// commands for a session, merged into one list (components/subwork/model.ts).
//
// Sources and gating (see LAB.md "Sub-work"):
//   subagents  agent.provider_subagents.list/update   features.providerSubagents (daemon >= 0.1.107)
//   scripts    workspace descriptor + script_status_update   always present
//   terminals  list_terminals / terminals_changed           always present
//   children   agent labels `frogg.parent-agent-id`         always present
//   background commands: derived from the timeline (no wire type)
// An older daemon simply yields fewer sources; nothing here throws or shows an error.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { useDirectory } from "../components/sessions/directory";
import {
  mergeSubWork,
  rollup,
  type ChildSrc,
  type Rollup,
  type ScriptSrc,
  type SubagentSrc,
  type SubWork,
  type TerminalSrc,
} from "../components/subwork/model";
import { getClient, onHostSwitch, useDaemon } from "./store";
import { bucketOf } from "./types";

const PARENT_LABEL = "frogg.parent-agent-id";
const TTL = 20_000;
const MAX_INFLIGHT = 3;

interface SubWorkState {
  subagents: Record<string, SubagentSrc[]>;
  scripts: Record<string, ScriptSrc[]>;
  terminals: Record<string, TerminalSrc[]>;
  children: Record<string, ChildSrc[]>;
  /** The user's own open/closed choice per session; absent means "automatic". */
  expanded: Record<string, boolean>;
}

export const useSubWorkStore = create<SubWorkState>(() => ({
  subagents: {},
  scripts: {},
  terminals: {},
  children: {},
  expanded: {},
}));

// ---- persisted expansion ------------------------------------------------------------------------

const KEY = "ui-next.subwork.expanded";
void AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) useSubWorkStore.setState({ expanded: JSON.parse(raw) as Record<string, boolean> });
    return raw;
  })
  .catch(() => undefined);
useSubWorkStore.subscribe((s, prev) => {
  if (s.expanded !== prev.expanded) void AsyncStorage.setItem(KEY, JSON.stringify(s.expanded));
});

export function setExpanded(sessionId: string, open: boolean): void {
  useSubWorkStore.setState((s) => ({ expanded: { ...s.expanded, [sessionId]: open } }));
}

// ---- capability gate ----------------------------------------------------------------------------

/** True when the connected daemon advertises provider subagents (v0.1.107+). */
export function supportsSubagents(): boolean {
  const info = getClient()?.getLastServerInfoMessage() as {
    features?: { providerSubagents?: boolean };
  } | null;
  return !!info?.features?.providerSubagents;
}

// ---- child sessions: derived from the session list, no RPC ---------------------------------------

function sig(c: ChildSrc): string {
  return `${c.id}|${c.title}|${c.bucket}|${c.updatedAt}`;
}

function recomputeChildren(): void {
  const prev = useSubWorkStore.getState().children;
  const next: Record<string, ChildSrc[]> = {};
  for (const x of Object.values(useDaemon.getState().sessions)) {
    const parent = x.agent.labels?.[PARENT_LABEL];
    if (!parent) continue;
    (next[parent] ??= []).push({
      id: x.agent.id,
      title: x.agent.title,
      bucket: bucketOf(x.agent),
      createdAt: x.agent.createdAt,
      updatedAt: x.agent.updatedAt,
    });
  }
  let changed = Object.keys(next).length !== Object.keys(prev).length;
  for (const [k, list] of Object.entries(next)) {
    const old = prev[k];
    if (old && old.length === list.length && old.every((o, i) => sig(o) === sig(list[i]))) {
      next[k] = old;
    } else changed = true;
  }
  if (changed) useSubWorkStore.setState({ children: next });
}
useDaemon.subscribe((s, p) => {
  if (s.sessions !== p.sessions) recomputeChildren();
});
recomputeChildren();

// ---- live raw events ----------------------------------------------------------------------------

let liveClient: unknown = null;
let unsubLive: (() => void) | null = null;

function upsert<T extends { id: string }>(cur: T[] | undefined, row: T): T[] {
  const list = cur ?? [];
  const at = list.findIndex((x) => x.id === row.id);
  if (at < 0) return [...list, row];
  const next = [...list];
  next[at] = row;
  return next;
}

/** One subscription for every session: subagent upserts, script status and terminal changes. */
export function ensureLive(): void {
  const client = getClient();
  if (!client || liveClient === client) return;
  unsubLive?.();
  liveClient = client;
  unsubLive = client.subscribeRawMessages((m) => {
    if (m.type === "agent.provider_subagents.update") {
      const p = m.payload;
      if (p.kind === "upsert") {
        const parent = p.subagent.parentAgentId;
        useSubWorkStore.setState((s) => ({
          subagents: { ...s.subagents, [parent]: upsert(s.subagents[parent], p.subagent) },
        }));
      } else if (p.kind === "remove") {
        useSubWorkStore.setState((s) => ({
          subagents: {
            ...s.subagents,
            [p.parentAgentId]: (s.subagents[p.parentAgentId] ?? []).filter(
              (x) => x.id !== p.subagentId,
            ),
          },
        }));
      }
    } else if (m.type === "script_status_update") {
      const { workspaceId, scripts } = m.payload;
      useSubWorkStore.setState((s) => ({ scripts: { ...s.scripts, [workspaceId]: scripts } }));
    } else if (m.type === "terminals_changed") {
      const { cwd, terminals } = m.payload;
      useSubWorkStore.setState((s) => ({ terminals: { ...s.terminals, [cwd]: terminals } }));
    }
  });
}

onHostSwitch(() => {
  unsubLive?.();
  unsubLive = null;
  liveClient = null;
  fetched.clear();
  useSubWorkStore.setState({ subagents: {}, scripts: {}, terminals: {} });
});

// ---- fetching -----------------------------------------------------------------------------------

const fetched = new Map<string, number>();
let inflight = 0;
const queue: Array<() => Promise<void>> = [];

function pump(): void {
  while (inflight < MAX_INFLIGHT && queue.length) {
    const job = queue.shift();
    if (!job) break;
    inflight += 1;
    void job().finally(() => {
      inflight -= 1;
      pump();
    });
  }
}
const enqueue = (job: () => Promise<void>) => {
  queue.push(job);
  pump();
};

/** Loads a session's subagents once per TTL (or when forced). Failures leave the list empty. */
export function loadSubagents(sessionId: string, force = false): void {
  const client = getClient();
  if (!client || !supportsSubagents()) return;
  const key = `sub:${sessionId}`;
  if (!force && Date.now() - (fetched.get(key) ?? 0) < TTL) return;
  fetched.set(key, Date.now());
  enqueue(async () => {
    try {
      const r = await client.listProviderSubagents(sessionId);
      if (getClient() !== client) return;
      useSubWorkStore.setState((s) => ({
        subagents: { ...s.subagents, [sessionId]: r.subagents },
      }));
    } catch {
      // Older or restricted daemon: no subagent affordances, no error.
    }
  });
}

export function loadTerminals(cwd: string, force = false): void {
  const client = getClient();
  if (!client) return;
  const key = `term:${cwd}`;
  if (!force && Date.now() - (fetched.get(key) ?? 0) < TTL) return;
  fetched.set(key, Date.now());
  enqueue(async () => {
    try {
      const r = await client.listTerminals(cwd);
      if (getClient() !== client) return;
      useSubWorkStore.setState((s) => ({ terminals: { ...s.terminals, [cwd]: r.terminals } }));
    } catch {
      // Terminals unavailable: leave the list as it was.
    }
  });
}

// ---- time ---------------------------------------------------------------------------------------

const tickers = new Set<(n: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

/** A shared 1s clock for every ticking elapsed label; idle (and stopped) when `on` is false. */
export function useNow(on = true): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return undefined;
    setNow(Date.now());
    tickers.add(setNow);
    timer ??= setInterval(() => {
      const n = Date.now();
      for (const fn of tickers) fn(n);
    }, 1000);
    return () => {
      tickers.delete(setNow);
      if (!tickers.size && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [on]);
  return now;
}

// ---- the hook -----------------------------------------------------------------------------------

const NONE: never[] = [];

export interface UseSubWork {
  items: SubWork[];
  counts: Rollup;
}

/**
 * Everything running under `sessionId`, live. `fetch` lets a caller (a list row for an idle
 * session) skip the RPCs; the open session and any working session always load.
 */
export function useSubWork(sessionId: string | null | undefined, fetch = true): UseSubWork {
  const sess = useDaemon((s) => (sessionId ? s.sessions[sessionId] : undefined));
  const timeline = useDaemon((s) => (sessionId ? s.timelines[sessionId] : undefined));
  const subagents = useSubWorkStore((s) => (sessionId ? s.subagents[sessionId] : undefined));
  const children = useSubWorkStore((s) => (sessionId ? s.children[sessionId] : undefined));
  const wsId = sess?.agent.workspaceId;
  const cwd = sess?.agent.cwd;
  const liveScripts = useSubWorkStore((s) => (wsId ? s.scripts[wsId] : undefined));
  const dirScripts = useDirectory((d) => (wsId ? d.workspaces[wsId]?.scripts : undefined));
  const terminals = useSubWorkStore((s) => (cwd ? s.terminals[cwd] : undefined));
  const status = sess?.agent.status;
  const was = useRef(status);
  useEffect(() => {
    if (!sessionId || !fetch) return;
    ensureLive();
    const settled = was.current === "running" && status !== "running";
    was.current = status;
    loadSubagents(sessionId, settled);
    if (cwd) loadTerminals(cwd, settled);
  }, [sessionId, fetch, status, cwd]);
  // The clock also re-evaluates the background-command staleness cut-off.
  const clock = useNow(
    !!subagents?.some((x) => x.status === "running") || status === "running" || !!children?.length,
  );
  const items = useMemo(() => {
    if (!sessionId) return NONE;
    return mergeSubWork(
      sessionId,
      wsId,
      {
        subagents,
        children,
        terminals,
        scripts: liveScripts ?? dirScripts,
        timeline: timeline as never,
      },
      clock,
    );
  }, [sessionId, wsId, subagents, children, terminals, liveScripts, dirScripts, timeline, clock]);
  const counts = useMemo(() => rollup(items), [items]);
  return { items, counts };
}

/** Running sub-work across the sessions in view, for the list header caption (excludes child
 * sessions: those are sessions in their own right and already counted in the five buckets). */
export function useRunningSubWork(sessionIds: string[]): number {
  const subagents = useSubWorkStore((s) => s.subagents);
  const scripts = useSubWorkStore((s) => s.scripts);
  const sessions = useDaemon((s) => s.sessions);
  return useMemo(() => {
    let n = 0;
    const seenWs = new Set<string>();
    for (const id of sessionIds) {
      n += (subagents[id] ?? NONE).filter((x) => x.status === "running").length;
      const ws = sessions[id]?.agent.workspaceId;
      if (ws && !seenWs.has(ws)) {
        seenWs.add(ws);
        n += (scripts[ws] ?? NONE).filter((x) => x.lifecycle === "running").length;
      }
    }
    return n;
  }, [sessionIds, subagents, scripts, sessions]);
}
