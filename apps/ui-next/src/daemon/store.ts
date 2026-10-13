import { DaemonClient } from "@frogg/client/internal/daemon-client";
import { useMemo } from "react";
import { create } from "zustand";
import {
  activeHost,
  hostClientOptions,
  hostsReady,
  hostUrl,
  markHostOnline,
  noteConnStatus,
  renameHost,
  useHosts,
  type Host,
} from "./hosts";
import { clientId, clientIdReady, deviceLabel } from "./client-id";
import type { Session, TimelineEntry } from "./types";

type Conn = "connecting" | "online" | "offline";
const CONN: Partial<Record<string, Conn>> = { connected: "online", connecting: "connecting" };

interface DaemonState {
  conn: Conn;
  url: string;
  serverName: string | null;
  sessions: Record<string, Session>;
  timelines: Record<string, TimelineEntry[]>;
  /** Live text of the assistant turn currently streaming, per agent. */
  streaming: Record<string, string>;
}

export const useDaemon = create<DaemonState>(() => ({
  conn: "connecting",
  url: "",
  serverName: null,
  sessions: {},
  timelines: {},
  streaming: {},
}));

let client: DaemonClient | null = null;
let connectionGeneration = 0;
export const getClient = () => client;

/**
 * Component lab only (`/lab`): installs an in-memory stand-in for the daemon client so
 * real components run against fixtures with no host. The app never calls this.
 */
export function attachFixtureClient(fake: unknown): void {
  ++connectionGeneration;
  client = fake as DaemonClient;
}

/** host:port used when nothing is saved yet: ?daemon=, then EXPO_PUBLIC_DAEMON, then this page's host. */
function defaultEndpoint(): string {
  const fromQuery =
    typeof location !== "undefined" ? new URLSearchParams(location.search).get("daemon") : null;
  if (fromQuery) return fromQuery;
  const env = process.env.EXPO_PUBLIC_DAEMON?.trim();
  if (env) return env.replace(/^wss?:\/\//, "").replace(/\/ws$/, "");
  return typeof location !== "undefined" ? `${location.hostname}:6767` : "127.0.0.1:6767";
}

/**
 * Every saved host keeps its own live connection, so sessions on all of them stay current.
 * One of them is active: `client` and `useDaemon` point at it, and everything else in the app
 * (files, terminals, settings, timelines) talks to that one. Switching hosts only repoints them.
 */
interface Pooled {
  host: Host;
  key: string;
  client: DaemonClient;
  conn: Conn;
  serverName: string | null;
}

const pool = new Map<string, Pooled>();
let activeHostId: string | null = null;

/** Sessions and link state of the hosts that are not active; the active host's live in useDaemon. */
export const useFleet = create<{
  sessions: Record<string, Record<string, Session>>;
  conn: Record<string, Conn>;
}>(() => ({ sessions: {}, conn: {} }));

/** Sessions of every connected host except the active one, each tagged with its hostId. */
export function useOtherHostSessions(): Session[] {
  const fleet = useFleet((st) => st.sessions);
  const activeId = useHosts((st) => st.activeId);
  return useMemo(() => {
    const out: Session[] = [];
    for (const [hostId, sessions] of Object.entries(fleet)) {
      if (hostId === activeId) continue;
      for (const sess of Object.values(sessions)) out.push({ ...sess, hostId });
    }
    return out;
  }, [fleet, activeId]);
}

/**
 * The live client of any saved host: the pooled one, or the active client when the host is the
 * active one (the component lab installs a lone fixture client that way). Null when not open.
 */
export function getHostClient(hostId: string | null | undefined): DaemonClient | null {
  if (!hostId || hostId === activeHostId || (!pool.size && client)) return client;
  return pool.get(hostId)?.client ?? null;
}

/** Link state of any saved host; the active one reads useDaemon so it matches the shell. */
export function useHostConn(hostId: string | null | undefined): Conn | null {
  const fleet = useFleet((st) => (hostId ? st.conn[hostId] : undefined));
  const active = useHosts((st) => st.activeId === hostId);
  const own = useDaemon((st) => st.conn);
  if (!hostId) return null;
  return active ? own : (fleet ?? null);
}

const routeKey = (h: Host) =>
  JSON.stringify([
    hostUrl(h),
    h.password ?? "",
    h.serverId ?? "",
    h.relay?.daemonPublicKeyB64 ?? "",
  ]);

const isActive = (p: Pooled) => activeHostId === p.host.id && client === p.client;

function setFleetSessions(
  hostId: string,
  fn: (prev: Record<string, Session>) => Record<string, Session>,
): void {
  useFleet.setState((st) => ({
    sessions: { ...st.sessions, [hostId]: fn(st.sessions[hostId] ?? {}) },
  }));
}

// The active host's list is edited in useDaemon (here and by actions elsewhere); keep its fleet copy
// current so switching back to it later starts from what was last shown.
useDaemon.subscribe((s, prev) => {
  if (activeHostId && s.sessions !== prev.sessions && pool.get(activeHostId)?.client === client)
    setFleetSessions(activeHostId, () => s.sessions);
});

function openPooled(host: Host): Pooled {
  const p: Pooled = {
    host,
    key: routeKey(host),
    conn: "connecting",
    serverName: null,
    client: new DaemonClient({
      url: hostUrl(host),
      ...(host.password ? { password: host.password } : {}),
      // One stable id per install: the daemon registers this app as a device under it.
      clientId: clientId(),
      clientType: "browser",
      deviceName: deviceLabel(),
      suppressSendErrors: true,
      reconnect: { enabled: true },
      ...hostClientOptions(host),
    }),
  };
  pool.set(host.id, p);
  const mine = p.client;
  mine.subscribeConnectionStatus((s) => {
    if (pool.get(host.id) !== p) return;
    p.conn = CONN[s.status] ?? "offline";
    useFleet.setState((st) => ({ conn: { ...st.conn, [host.id]: p.conn } }));
    if (isActive(p)) {
      noteConnStatus(host.id, s, mine.lastErrorInfo);
      useDaemon.setState({ conn: p.conn });
    } else if (s.status === "connected") markHostOnline(host.id);
    if (s.status === "connected") void loadSessions(p).catch(() => {});
  });
  mine.subscribe((event) => {
    if (pool.get(host.id) !== p) return;
    if (event.type === "agent_update" || event.type === "agent_deleted") {
      const apply = (prev: Record<string, Session>) => {
        const sessions = { ...prev };
        if (event.type === "agent_deleted") delete sessions[event.agentId];
        else if (event.payload.kind === "upsert") {
          const { agent, project } = event.payload;
          sessions[agent.id] = { agent, project: project ?? sessions[agent.id]?.project ?? null };
        } else delete sessions[event.payload.agentId];
        return sessions;
      };
      if (isActive(p)) useDaemon.setState((st) => ({ sessions: apply(st.sessions) }));
      else setFleetSessions(host.id, apply);
    } else if (event.type === "agent_stream" && isActive(p)) {
      const e = event.event;
      if (e.type === "timeline") {
        const entry: TimelineEntry = {
          provider: e.provider,
          item: e.item,
          turnId: e.turnId,
          timestamp: event.timestamp,
          seqStart: event.seq ?? 0,
          seqEnd: event.seq ?? 0,
          sourceSeqRanges: [],
          collapsed: [],
        };
        useDaemon.setState((st) => ({
          timelines: {
            ...st.timelines,
            [event.agentId]: mergeEntry(st.timelines[event.agentId] ?? [], entry),
          },
        }));
      }
    }
  });
  mine.connect().catch(() => {
    if (pool.get(host.id) !== p) return;
    p.conn = "offline";
    useFleet.setState((st) => ({ conn: { ...st.conn, [host.id]: "offline" } }));
    if (isActive(p)) useDaemon.setState({ conn: "offline" });
  });
  return p;
}

function closePooled(id: string): void {
  const p = pool.get(id);
  if (!p) return;
  pool.delete(id);
  void p.client.close().catch(() => {});
  useFleet.setState((st) => {
    const sessions = { ...st.sessions };
    const conn = { ...st.conn };
    delete sessions[id];
    delete conn[id];
    return { sessions, conn };
  });
}

/** Opens a connection to every saved host that lacks one and drops those of forgotten hosts. */
function syncPool(): void {
  const hosts = useHosts.getState().hosts;
  // Deleting the current entry while iterating a Map is safe.
  for (const id of pool.keys()) if (!hosts.some((h) => h.id === id)) closePooled(id);
  for (const h of hosts) {
    const p = pool.get(h.id);
    if (!p) openPooled(h);
    else p.host = h;
  }
}

let pooling = false;
function startPool(): void {
  if (pooling) return;
  pooling = true;
  syncPool();
  useHosts.subscribe((s, prev) => {
    if (s.hosts !== prev.hosts) syncPool();
  });
}

/**
 * Makes a saved host the active one. Its connection is reused when already open; asking for the
 * host that is already active, or one whose address changed, opens a fresh connection (a retry).
 */
export async function connect(host?: Host): Promise<void> {
  const generation = ++connectionGeneration;
  await Promise.all([hostsReady, clientIdReady]);
  if (generation !== connectionGeneration) return;
  const target = host ?? activeHost(defaultEndpoint());
  startPool();
  const previous = activeHostId ? pool.get(activeHostId) : undefined;
  let p = pool.get(target.id);
  if (p && (p.key !== routeKey(target) || target.id === activeHostId || p.conn === "offline")) {
    closePooled(target.id);
    p = undefined;
  }
  if (previous && previous !== p)
    void previous.client.setAgentTimelineSubscription([]).catch(() => {});
  activeHostId = target.id;
  client = null;
  useHosts.setState({ activeId: target.id });
  p ??= openPooled(target);
  client = p.client;
  useDaemon.setState({
    url: hostUrl(target),
    conn: p.conn,
    sessions: useFleet.getState().sessions[target.id] ?? {},
    timelines: {},
    streaming: {},
    serverName: p.serverName,
  });
  if (p.conn === "online") {
    noteConnStatus(target.id, { status: "connected" }, null);
    void loadSessions(p).catch(() => {});
  }
}

/** Leaves no host active; the other hosts' connections stay open. Never stops a daemon. */
export async function disconnect(): Promise<void> {
  ++connectionGeneration;
  const old = activeHostId;
  activeHostId = null;
  client = null;
  useHosts.setState({ activeId: null });
  useDaemon.setState({
    conn: "offline",
    url: "",
    serverName: null,
    sessions: {},
    timelines: {},
    streaming: {},
  });
  if (old) closePooled(old);
}

/** Streamed chunks of one assistant message arrive as separate items; fold them together. */
function mergeEntry(list: TimelineEntry[], entry: TimelineEntry): TimelineEntry[] {
  const last = list[list.length - 1];
  const item = entry.item;
  if (
    last &&
    (item.type === "assistant_message" || item.type === "reasoning") &&
    last.item.type === item.type &&
    last.turnId === entry.turnId &&
    ("messageId" in item
      ? item.messageId === (last.item as { messageId?: string }).messageId
      : true)
  ) {
    return [...list.slice(0, -1), { ...last, item: { ...item, text: last.item.text + item.text } }];
  }
  if (item.type === "tool_call") {
    const i = list.findIndex((x) => x.item.type === "tool_call" && x.item.callId === item.callId);
    if (i >= 0) return [...list.slice(0, i), entry, ...list.slice(i + 1)];
  }
  return [...list, entry];
}

async function loadSessions(p: Pooled): Promise<void> {
  const source = p.client;
  const res = await source.fetchAgents({ page: { limit: 200 }, subscribe: {} });
  if (pool.get(p.host.id) !== p) return;
  const sessions: Record<string, Session> = {};
  for (const e of res.entries)
    if (!e.agent.archivedAt) sessions[e.agent.id] = { agent: e.agent, project: e.project };
  const info = source.getLastServerInfoMessage() as {
    hostname?: string;
  } | null;
  p.serverName = info?.hostname ?? null;
  if (isActive(p)) useDaemon.setState({ sessions, serverName: p.serverName });
  else setFleetSessions(p.host.id, () => sessions);
  // A host saved by address alone takes the daemon's own name once we have it.
  const host = useHosts.getState().hosts.find((h) => h.id === p.host.id);
  if (host && info?.hostname && host.name === host.endpoint.split(":")[0])
    renameHost(host.id, info.hostname);
}

const subscribed = new Set<string>();
/** Per-host caches elsewhere reset themselves through this; called on every host switch. */
export function onHostSwitch(fn: () => void): void {
  useDaemon.subscribe((s, prev) => {
    if (s.url !== prev.url) fn();
  });
}
onHostSwitch(() => subscribed.clear());

export async function openTimeline(agentId: string): Promise<void> {
  if (!client) return;
  if (!subscribed.has(agentId)) {
    subscribed.add(agentId);
    await client.setAgentTimelineSubscription([...subscribed]);
  }
  const res = await client.fetchAgentTimeline(agentId, {
    direction: "tail",
    limit: 200,
  });
  useDaemon.setState((st) => ({
    timelines: { ...st.timelines, [agentId]: res.entries },
  }));
}

export async function send(agentId: string, text: string): Promise<void> {
  await client?.sendMessage(agentId, text);
}

export async function answerPermission(
  agentId: string,
  requestId: string,
  allow: boolean,
  selectedActionId?: string,
): Promise<void> {
  await client?.respondToPermission(
    agentId,
    requestId,
    allow
      ? { behavior: "allow", selectedActionId }
      : { behavior: "deny", message: "Denied from Frogg" },
  );
}

export type Project = Awaited<ReturnType<DaemonClient["listProjects"]>>["projects"][number];

export async function listProjects(): Promise<Project[]> {
  return (await client?.listProjects())?.projects ?? [];
}

export async function createSession(input: {
  cwd: string;
  provider: string;
  model?: string;
  modeId?: string;
  title?: string;
  initialPrompt: string;
  worktree?: { mode: "branch-off"; newBranch: string; base?: string };
}): Promise<string> {
  if (!client) throw new Error("not connected");
  const agent = await client.createAgent({
    provider: input.provider as never,
    cwd: input.cwd,
    model: input.model,
    modeId: input.modeId,
    title: input.title,
    initialPrompt: input.initialPrompt,
    worktree: input.worktree,
  });
  useDaemon.setState((st) => ({
    sessions: {
      ...st.sessions,
      [agent.id]: { agent, project: st.sessions[agent.id]?.project ?? null },
    },
  }));
  return agent.id;
}

export async function cancelTurn(agentId: string): Promise<void> {
  await client?.cancelAgent(agentId);
}

export async function archiveSession(agentId: string): Promise<void> {
  await client?.archiveAgent(agentId);
  useDaemon.setState((st) => {
    const sessions = { ...st.sessions };
    delete sessions[agentId];
    return { sessions };
  });
}

export async function setAgentModel(agentId: string, model: string): Promise<void> {
  await client?.setAgentModel(agentId, model);
}

export async function setAgentMode(agentId: string, modeId: string): Promise<void> {
  await client?.setAgentMode(agentId, modeId);
}
