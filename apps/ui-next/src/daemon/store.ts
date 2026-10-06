import { DaemonClient } from "@frogg/client/internal/daemon-client";
import { create } from "zustand";
import { activeHost, hostUrl, renameHost, useHosts, type Host } from "./hosts";
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
export const getClient = () => client;

/** host:port used when nothing is saved yet: ?daemon=, then EXPO_PUBLIC_DAEMON, then this page's host. */
function defaultEndpoint(): string {
  const fromQuery =
    typeof location !== "undefined" ? new URLSearchParams(location.search).get("daemon") : null;
  if (fromQuery) return fromQuery;
  const env = process.env.EXPO_PUBLIC_DAEMON?.trim();
  if (env) return env.replace(/^wss?:\/\//, "").replace(/\/ws$/, "");
  return typeof location !== "undefined" ? `${location.hostname}:6767` : "127.0.0.1:6767";
}

/** Connects to the active saved host, replacing any current connection and its per-host state. */
export async function connect(host?: Host): Promise<void> {
  const target = host ?? activeHost(defaultEndpoint());
  if (client) {
    const old = client;
    client = null;
    await old.close().catch(() => {});
  }
  useHosts.setState({ activeId: target.id });
  const url = hostUrl(target);
  useDaemon.setState({
    url,
    conn: "connecting",
    sessions: {},
    timelines: {},
    streaming: {},
    serverName: null,
  });
  const mine = new DaemonClient({
    url,
    ...(target.password ? { password: target.password } : {}),
    clientId: `ui-next-${Math.random().toString(36).slice(2, 10)}`,
    clientType: "browser",
    deviceName: "Frogg (next)",
    suppressSendErrors: true,
    reconnect: { enabled: true },
  });
  client = mine;
  mine.subscribeConnectionStatus((s) => {
    if (client !== mine) return;
    useDaemon.setState({
      conn: CONN[s.status] ?? "offline",
    });
    if (s.status === "connected") void loadSessions();
  });
  mine.subscribe((event) => {
    if (client !== mine) return;
    if (event.type === "agent_update") {
      const p = event.payload;
      useDaemon.setState((st) => {
        const sessions = { ...st.sessions };
        if (p.kind === "upsert") {
          sessions[p.agent.id] = {
            agent: p.agent,
            project: p.project ?? sessions[p.agent.id]?.project ?? null,
          };
        } else delete sessions[p.agentId];
        return { sessions };
      });
    } else if (event.type === "agent_deleted") {
      useDaemon.setState((st) => {
        const sessions = { ...st.sessions };
        delete sessions[event.agentId];
        return { sessions };
      });
    } else if (event.type === "agent_stream") {
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
  try {
    await mine.connect();
  } catch {
    if (client === mine) useDaemon.setState({ conn: "offline" });
  }
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

async function loadSessions(): Promise<void> {
  if (!client) return;
  const res = await client.fetchAgents({ page: { limit: 200 }, subscribe: {} });
  const sessions: Record<string, Session> = {};
  for (const e of res.entries)
    if (!e.agent.archivedAt) sessions[e.agent.id] = { agent: e.agent, project: e.project };
  const info = client.getLastServerInfoMessage() as {
    hostname?: string;
  } | null;
  useDaemon.setState({ sessions, serverName: info?.hostname ?? null });
  // A host saved by address alone takes the daemon's own name once we have it.
  const st = useHosts.getState();
  const host = st.hosts.find((h) => h.id === st.activeId);
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
