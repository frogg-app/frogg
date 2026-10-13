// The unified "sub-work" model: everything a session has running underneath it, from every source
// the daemon exposes, as one list with roll-up counts. Pure functions only; the live store that
// feeds them is daemon/subwork.ts, the lab feeds them simulated rows.

export type SubWorkKind = "subagent" | "background-task" | "terminal" | "script" | "child-session";
/** `attention` is "waiting on you" (a terminal asking for input, a child session with a prompt). */
export type SubWorkStatus = "running" | "attention" | "done" | "failed" | "idle";

export interface SubWork {
  id: string;
  kind: SubWorkKind;
  label: string;
  status: SubWorkStatus;
  /** Epoch ms the work began; null when the source does not say. */
  startedAt: number | null;
  /** Epoch ms it finished, for settled work. */
  endedAt?: number | null;
  /** What it was asked to do, when that differs from the label. */
  detail?: string;
  /** The latest activity line ("Grep · evictOldest"), when the source reports one. */
  activity?: string;
  /** A service script's port. */
  port?: number;
  /** The session this work belongs to. */
  parentId: string;
  /** Another sub-work item this one runs under (a Workflow's agents). */
  nestedUnder?: string | null;
  /** The tool call that spawned it, to link a timeline row to this item. */
  toolCallId?: string | null;
  /** A session or terminal id the row can open. */
  openId?: string;
}

export interface Rollup {
  running: number;
  attention: number;
  failed: number;
  done: number;
  idle: number;
  total: number;
  /** Work worth a glance: running, waiting on you or failed. */
  active: number;
}

export const KIND_ORDER: SubWorkKind[] = [
  "subagent",
  "child-session",
  "background-task",
  "terminal",
  "script",
];

export const KIND_LABEL: Record<SubWorkKind, string> = {
  subagent: "Subagents",
  "child-session": "Child sessions",
  "background-task": "Background commands",
  terminal: "Terminals",
  script: "Scripts",
};

export const KIND_NOUN: Record<SubWorkKind, string> = {
  subagent: "subagent",
  "child-session": "child session",
  "background-task": "background command",
  terminal: "terminal",
  script: "script",
};

// ---- source shapes (structural, so the model needs no protocol import) --------------------------

export interface SubagentSrc {
  id: string;
  title: string | null;
  description: string | null;
  status: "running" | "completed" | "failed" | "canceled";
  createdAt: string;
  updatedAt: string;
  toolCallId: string | null;
  subtitle?: string | null;
  parentSubagentId?: string | null;
}

export interface ScriptSrc {
  scriptName: string;
  type?: "script" | "service";
  port: number | null;
  lifecycle: "running" | "stopped";
  health: "healthy" | "unhealthy" | null;
  exitCode?: number | null;
  terminalId?: string | null;
}

export interface TerminalSrc {
  id: string;
  name: string;
  title?: string;
  activity?: { state?: string; attentionReason?: string | null; changedAt?: number } | null;
}

export interface ChildSrc {
  id: string;
  title: string | null;
  /** The session list bucket of the child. */
  bucket: "needs" | "failed" | "review" | "working" | "idle";
  createdAt: string;
  updatedAt: string;
  activity?: string;
}

export interface TimelineSrc {
  timestamp: string;
  item: {
    type: string;
    callId?: string;
    name?: string;
    status?: string;
    detail?: { type?: string; command?: string; output?: string } | null;
  };
}

export interface SubWorkSources {
  subagents?: SubagentSrc[];
  scripts?: ScriptSrc[];
  terminals?: TerminalSrc[];
  children?: ChildSrc[];
  timeline?: TimelineSrc[];
}

const ms = (iso: string): number | null => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

// ---- per-source mappers -------------------------------------------------------------------------

const SUB_STATUS: Record<SubagentSrc["status"], SubWorkStatus> = {
  running: "running",
  completed: "done",
  failed: "failed",
  canceled: "idle",
};

export function fromSubagent(parentId: string, a: SubagentSrc): SubWork {
  const status = SUB_STATUS[a.status];
  return {
    id: `sub:${a.id}`,
    kind: "subagent",
    label: a.title ?? a.description ?? "Subagent",
    status,
    startedAt: ms(a.createdAt),
    endedAt: status === "running" ? null : ms(a.updatedAt),
    detail: a.title && a.description && a.description !== a.title ? a.description : undefined,
    activity: a.subtitle ?? undefined,
    parentId,
    nestedUnder: a.parentSubagentId ? `sub:${a.parentSubagentId}` : null,
    toolCallId: a.toolCallId,
  };
}

export function fromScript(parentId: string, workspaceId: string, sc: ScriptSrc): SubWork {
  let status: SubWorkStatus = "idle";
  if (sc.lifecycle === "running") status = sc.health === "unhealthy" ? "failed" : "running";
  else if (sc.exitCode) status = "failed";
  return {
    id: `script:${workspaceId}:${sc.scriptName}`,
    kind: "script",
    label: sc.scriptName,
    status,
    startedAt: null,
    port: sc.port ?? undefined,
    activity: sc.health === "unhealthy" ? "unhealthy" : undefined,
    parentId,
    openId: sc.terminalId ?? undefined,
  };
}

export function fromTerminal(parentId: string, t: TerminalSrc): SubWork {
  const state = t.activity?.state;
  let status: SubWorkStatus = "idle";
  if (state === "working") status = "running";
  else if (state === "attention")
    status = t.activity?.attentionReason === "needs_input" ? "attention" : "done";
  return {
    id: `term:${t.id}`,
    kind: "terminal",
    label: t.title || t.name,
    status,
    startedAt: t.activity?.changedAt ?? null,
    parentId,
    openId: t.id,
  };
}

const CHILD_STATUS: Record<ChildSrc["bucket"], SubWorkStatus> = {
  working: "running",
  needs: "attention",
  failed: "failed",
  review: "done",
  idle: "done",
};

export function fromChild(parentId: string, c: ChildSrc): SubWork {
  return {
    id: `child:${c.id}`,
    kind: "child-session",
    label: c.title || "Untitled session",
    status: CHILD_STATUS[c.bucket],
    startedAt: ms(c.createdAt),
    endedAt: c.bucket === "working" ? null : ms(c.updatedAt),
    activity: c.activity,
    parentId,
    openId: c.id,
  };
}

// Background shells (Bash run_in_background) are not on the subagent track; the daemon only leaves
// a shell tool call whose result says it went to the background, and later a `task_notification_*`
// call when it settles. That is all there is to derive from, so this is a heuristic.
const BG_OUTPUT = /background/i;
const BG_ID = /\bID[:\s]+([A-Za-z0-9_-]{4,})/i;
/** A background command with no settling notification after this long is treated as gone. */
export const BG_STALE_MS = 6 * 60 * 60 * 1000;

export function fromTimeline(parentId: string, entries: TimelineSrc[], now: number): SubWork[] {
  const notes = entries.filter(
    (e) => e.item.type === "tool_call" && e.item.callId?.startsWith("task_notification_"),
  );
  const out: SubWork[] = [];
  for (const e of entries) {
    const it = e.item;
    if (it.type !== "tool_call" || it.detail?.type !== "shell" || !it.callId) continue;
    if (!it.detail.output || !BG_OUTPUT.test(it.detail.output)) continue;
    const taskId = BG_ID.exec(it.detail.output)?.[1];
    const note = taskId ? notes.find((n) => n.item.callId?.includes(taskId)) : undefined;
    const started = ms(e.timestamp);
    let status: SubWorkStatus = "running";
    if (note) status = note.item.status === "failed" ? "failed" : "done";
    else if (started !== null && now - started > BG_STALE_MS) status = "idle";
    out.push({
      id: `bg:${it.callId}`,
      kind: "background-task",
      label: (it.detail.command ?? "command").replace(/\s+/g, " ").slice(0, 80),
      status,
      startedAt: started,
      endedAt: note ? ms(note.timestamp) : null,
      parentId,
      toolCallId: it.callId,
    });
  }
  return out;
}

// ---- merge and roll-up --------------------------------------------------------------------------

const RANK: Record<SubWorkStatus, number> = {
  attention: 0,
  failed: 1,
  running: 2,
  done: 3,
  idle: 4,
};

/** Every source as one list: waiting-on-you first, then failed, running, done, idle. */
export function mergeSubWork(
  parentId: string,
  workspaceId: string | undefined,
  src: SubWorkSources,
  now: number,
): SubWork[] {
  const all: SubWork[] = [
    ...(src.subagents ?? []).map((a) => fromSubagent(parentId, a)),
    ...(src.children ?? []).map((c) => fromChild(parentId, c)),
    ...fromTimeline(parentId, src.timeline ?? [], now),
    ...(src.terminals ?? []).map((t) => fromTerminal(parentId, t)),
    ...(src.scripts ?? []).map((sc) => fromScript(parentId, workspaceId ?? "ws", sc)),
  ];
  return all
    .map((x, i) => ({ x, i }))
    .sort((a, b) => RANK[a.x.status] - RANK[b.x.status] || a.i - b.i)
    .map((o) => o.x);
}

export function rollup(items: SubWork[]): Rollup {
  const r: Rollup = {
    running: 0,
    attention: 0,
    failed: 0,
    done: 0,
    idle: 0,
    total: items.length,
    active: 0,
  };
  for (const x of items) r[x.status] += 1;
  r.active = r.running + r.attention + r.failed;
  return r;
}

/** Items that count toward the chip: settled-and-quiet work (stopped scripts, idle shells) does not. */
export function visibleItems(items: SubWork[]): SubWork[] {
  return items.filter((x) => x.status !== "idle");
}

/** Open by default only when something is waiting on you or failed. */
export const needsAttention = (r: Rollup): boolean => r.attention + r.failed > 0;

/** "3 subagents · 1 background command", for captions and labels. */
export function describe(items: SubWork[]): string {
  const by = new Map<SubWorkKind, number>();
  for (const x of items) by.set(x.kind, (by.get(x.kind) ?? 0) + 1);
  return KIND_ORDER.filter((k) => by.has(k))
    .map((k) => {
      const n = by.get(k) ?? 0;
      return `${n} ${KIND_NOUN[k]}${n === 1 ? "" : "s"}`;
    })
    .join(" · ");
}

/** "12s", "3m 04s", "1h 05m". */
export function elapsed(from: number, to: number): string {
  const s = Math.max(0, Math.floor((to - from) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${`${s % 60}`.padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${`${Math.floor((s % 3600) / 60)}`.padStart(2, "0")}m`;
}
