// Projects host timeline rows and permission requests into the reduced shapes plugin API v2 exposes.
// Pure functions: reasoning is dropped, tool calls become a name plus a one-line gist, and every
// free-text field is capped so a plugin never receives an unbounded payload.
import type {
  PluginPermissionRequest,
  PluginTimelineEntry,
  PluginTimelineItem,
} from "@frogg/protocol/plugins/api-v1";
import type {
  AgentPermissionRequest,
  AgentTimelineItem,
  ToolCallDetail,
} from "../agent/agent-sdk-types.js";
import type { AgentTimelineCursor, AgentTimelineRow } from "../agent/agent-timeline-store-types.js";

const MAX_TEXT = 100_000;
const MAX_SUMMARY = 200;
const MAX_PREVIEW = 1_000;

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function oneLine(text: string, max: number): string {
  return cap(text.replace(/\s+/g, " ").trim(), max);
}

export function summarizeToolDetail(detail: ToolCallDetail | undefined): string | undefined {
  if (!detail) return undefined;
  switch (detail.type) {
    case "shell":
      return oneLine(detail.command, MAX_SUMMARY);
    case "read":
    case "edit":
    case "write":
      return oneLine(detail.filePath, MAX_SUMMARY);
    case "search":
      return oneLine(detail.query, MAX_SUMMARY);
    case "fetch":
      return oneLine(detail.url, MAX_SUMMARY);
    case "sub_agent":
      return detail.description ? oneLine(detail.description, MAX_SUMMARY) : undefined;
    case "plain_text":
      return detail.text || detail.label
        ? oneLine(detail.text ?? detail.label ?? "", MAX_SUMMARY)
        : undefined;
    case "plan":
      return oneLine(detail.text, MAX_SUMMARY);
    default:
      return undefined;
  }
}

/** Null for items plugins never see (reasoning). */
export function projectTimelineItem(item: AgentTimelineItem): PluginTimelineItem | null {
  switch (item.type) {
    case "user_message":
      return { type: "user_message", text: cap(item.text, MAX_TEXT) };
    case "assistant_message":
      return { type: "assistant_message", text: cap(item.text, MAX_TEXT) };
    case "reasoning":
      return null;
    case "tool_call": {
      if (item.detail?.type === "plan")
        return { type: "plan", text: cap(item.detail.text, MAX_TEXT) };
      const summary = summarizeToolDetail(item.detail);
      return {
        type: "tool_call",
        callId: item.callId,
        name: item.name,
        status: item.status,
        ...(summary ? { summary } : {}),
      };
    }
    case "todo":
      return {
        type: "todo",
        items: item.items.map((t) => ({
          text: oneLine(t.text, MAX_SUMMARY),
          completed: t.completed,
        })),
      };
    case "error":
      return { type: "error", message: cap(item.message, MAX_PREVIEW * 4) };
    case "compaction":
      return { type: "compaction" };
    default:
      return null;
  }
}

export function projectTimelineRow(row: AgentTimelineRow): PluginTimelineEntry | null {
  const item = projectTimelineItem(row.item);
  if (!item) return null;
  return {
    seq: row.seq,
    timestamp: row.timestamp,
    ...(row.turnId ? { turnId: row.turnId } : {}),
    item,
  };
}

// Cursors are "<epoch>:<seq>". The epoch changes when the host rebuilds a timeline, which is how a
// stale cursor is detected.
export function encodeTimelineCursor(cursor: AgentTimelineCursor): string {
  return `${cursor.epoch}:${cursor.seq}`;
}

export function decodeTimelineCursor(value: string | null | undefined): AgentTimelineCursor | null {
  if (!value) return null;
  const at = value.lastIndexOf(":");
  if (at <= 0) return null;
  const seq = Number(value.slice(at + 1));
  if (!Number.isInteger(seq) || seq < 0) return null;
  return { epoch: value.slice(0, at), seq };
}

function previewInput(request: AgentPermissionRequest): string | undefined {
  const fromDetail = summarizeToolDetail(request.detail);
  if (request.detail?.type === "plan") return cap(request.detail.text, MAX_PREVIEW);
  if (fromDetail) return fromDetail;
  if (request.input === undefined) return undefined;
  try {
    return oneLine(JSON.stringify(request.input), MAX_PREVIEW);
  } catch {
    return undefined;
  }
}

export function projectPermissionRequest(
  agentId: string,
  request: AgentPermissionRequest,
): PluginPermissionRequest {
  const inputPreview = previewInput(request);
  return {
    agentId,
    requestId: request.id,
    name: request.name,
    kind: request.kind,
    ...(request.title ? { title: oneLine(request.title, MAX_SUMMARY) } : {}),
    ...(request.description ? { description: cap(request.description, MAX_PREVIEW) } : {}),
    ...(inputPreview ? { inputPreview } : {}),
    canAlways: (request.suggestions?.length ?? 0) > 0,
  };
}
