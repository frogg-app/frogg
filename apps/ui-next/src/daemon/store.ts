import { DaemonClient } from "@frogg/client/internal/daemon-client";
import { create } from "zustand";
import type { Session, TimelineEntry } from "./types";

type Conn = "connecting" | "online" | "offline";

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

function resolveUrl(): string {
  const env = process.env.EXPO_PUBLIC_DAEMON?.trim();
  if (env) return env.startsWith("ws") ? env : `ws://${env}/ws`;
  if (typeof location !== "undefined") {
    const fromQuery = new URLSearchParams(location.search).get("daemon");
    if (fromQuery) return `ws://${fromQuery}/ws`;
    return `ws://${location.hostname}:6767/ws`;
  }
  return "ws://127.0.0.1:6767/ws";
}

export async function connect(): Promise<void> {
  if (client) return;
  const url = resolveUrl();
  useDaemon.setState({ url, conn: "connecting" });
  client = new DaemonClient({
    url,
    clientId: `ui-next-${Math.random().toString(36).slice(2, 10)}`,
    clientType: "browser",
    deviceName: "Frogg (next)",
    suppressSendErrors: true,
    reconnect: { enabled: true },
  });
  client.subscribeConnectionStatus((s) => {
    useDaemon.setState({ conn: s.status === "connected" ? "online" : s.status === "connecting" ? "connecting" : "offline" });
    if (s.status === "connected") void loadSessions();
  });
  client.subscribe((event) => {
    if (event.type === "agent_update") {
      const p = event.payload;
      useDaemon.setState((st) => {
        const sessions = { ...st.sessions };
        if (p.kind === "upsert") {
          sessions[p.agent.id] = { agent: p.agent, project: p.project ?? sessions[p.agent.id]?.project ?? null };
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
          timelines: { ...st.timelines, [event.agentId]: mergeEntry(st.timelines[event.agentId] ?? [], entry) },
        }));
      }
    }
  });
  try {
    await client.connect();
  } catch {
    useDaemon.setState({ conn: "offline" });
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
    ("messageId" in item ? item.messageId === (last.item as { messageId?: string }).messageId : true)
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
  for (const e of res.entries) if (!e.agent.archivedAt) sessions[e.agent.id] = { agent: e.agent, project: e.project };
  const info = client.getLastServerInfoMessage() as { hostname?: string } | null;
  useDaemon.setState({ sessions, serverName: info?.hostname ?? null });
}

const subscribed = new Set<string>();
export async function openTimeline(agentId: string): Promise<void> {
  if (!client) return;
  if (!subscribed.has(agentId)) {
    subscribed.add(agentId);
    await client.setAgentTimelineSubscription([...subscribed]);
  }
  const res = await client.fetchAgentTimeline(agentId, { direction: "tail", limit: 200 });
  useDaemon.setState((st) => ({ timelines: { ...st.timelines, [agentId]: res.entries } }));
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
    allow ? { behavior: "allow", selectedActionId } : { behavior: "deny", message: "Denied from Frogg" },
  );
}
