import { z } from "zod";

import type { AgentTimelineItem } from "../../../agent-sdk-types.js";
import { normalizeProviderReplayTimestamp } from "../../../provider-history-timestamps.js";
import type { ProviderSubagentStatus } from "../../../provider-subagents/store.js";
import { resolveObservedClaudeModelId } from "../models.js";
import type { SubagentObservation } from "./observation.js";
import { buildClaudeSubagentSubtitle } from "./presentation.js";
import type { ClaudeReplayEntry } from "./replay-source.js";

/**
 * The agents a Claude Code Workflow run fans out, as rows beneath the Workflow's own row.
 *
 * A workflow is the one Claude construct that owns subagents Frogg cannot hear about on the SDK
 * stream: the run executes inside the CLI and announces only itself, so `local_workflow` arrives
 * as a single task and its children are never declared. What they do leave behind is a run
 * directory, and that is what this module reads.
 *
 * Verified on disk (Claude Code 2.1.220), under
 * `<session>/subagents/workflows/<runId>/`:
 *
 *   journal.jsonl              {"type":"launched"}
 *                              {"type":"started","key","agentId","label","phase"}
 *                              {"type":"result","key","agentId","result"}
 *   agent-<agentId>.meta.json  {"agentType":"workflow-subagent","description","workflowPhase",
 *                               "model","worktreePath","spawnDepth",…}
 *   agent-<agentId>.jsonl      the child's own transcript, in the parent's sidechain format
 *
 * and, once the run finishes, `<session>/workflows/<runId>.json` adds a `workflowProgress` array
 * whose `workflow_agent` entries carry the richest per-child facts (state, model, tokens, the
 * last tool it ran). The journal is written from launch, so it — not the run summary — is what
 * makes a child visible while it is still working; the summary is a later enrichment, not a
 * prerequisite. Every field of all three is undocumented internals and therefore optional.
 */

/** Separates the Workflow row's id from the child's agent id in a composite descriptor id. */
const WORKFLOW_CHILD_ID_SEPARATOR = "::";

/** Keeps a wordy prompt preview from crowding out the rest of a one-line row. */
const MAX_CHILD_DESCRIPTION_CHARS = 200;

/**
 * A child's descriptor id.
 *
 * Claude's `agentId` is unique only inside its run, and the same run can be replayed under a
 * session that also ran other workflows, so the Workflow row's id is what makes it addressable.
 * Deriving it rather than allocating one is what lets the live poller and replay converge on the
 * same row instead of producing two.
 */
export function workflowChildSubagentId(workflowSubagentId: string, agentId: string): string {
  return `${workflowSubagentId}${WORKFLOW_CHILD_ID_SEPARATOR}${agentId}`;
}

const WorkflowJournalLineSchema = z.union([
  z.object({
    type: z.literal("started"),
    agentId: z.string(),
    label: z.string().optional().catch(undefined),
    phase: z.string().optional().catch(undefined),
  }),
  z.object({
    type: z.literal("result"),
    agentId: z.string(),
    result: z.unknown().optional(),
  }),
]);

const WorkflowChildMetaSchema = z.object({
  agentType: z.string().optional().catch(undefined),
  description: z.string().optional().catch(undefined),
  workflowPhase: z.string().optional().catch(undefined),
  model: z.string().optional().catch(undefined),
  worktreePath: z.string().optional().catch(undefined),
});

export type ClaudeWorkflowChildMeta = z.infer<typeof WorkflowChildMetaSchema>;

/**
 * One `workflow_agent` entry of a finished run's `workflowProgress`.
 *
 * `state` is Claude's own word for the child's outcome and is the only per-child status the run
 * summary carries; the journal expresses the same thing structurally, by whether a `result` line
 * exists. Both are read, and the summary wins when present, because it distinguishes a failure
 * from a success where the journal does not.
 */
const WorkflowProgressAgentSchema = z.object({
  type: z.literal("workflow_agent"),
  agentId: z.string(),
  label: z.string().optional().catch(undefined),
  phaseTitle: z.string().optional().catch(undefined),
  model: z.string().optional().catch(undefined),
  state: z.string().optional().catch(undefined),
  tokens: z.number().optional().catch(undefined),
  promptPreview: z.string().optional().catch(undefined),
  resultPreview: z.string().optional().catch(undefined),
  lastToolName: z.string().optional().catch(undefined),
  lastToolSummary: z.string().optional().catch(undefined),
  startedAt: z.number().optional().catch(undefined),
});

export type ClaudeWorkflowProgressAgent = z.infer<typeof WorkflowProgressAgentSchema>;

/** Everything known about one workflow child, merged from every source that mentions it. */
export interface ClaudeWorkflowChild {
  agentId: string;
  label?: string;
  phase?: string;
  model?: string;
  /** Claude's own word for the outcome, when the run summary supplied one. */
  state?: string;
  totalTokens?: number;
  description?: string;
  /** The child's final answer, from whichever source recorded it. */
  result?: string;
  /** The last tool the child ran, as a single display-ready line. */
  lastActivity?: string;
  startedAt?: number;
  /** Whether the journal recorded a terminal result line for this child. */
  finished: boolean;
}

export function parseWorkflowChildMeta(contents: string): ClaudeWorkflowChildMeta | null {
  const parsed = safeParseJson(contents);
  if (parsed === undefined) return null;
  const result = WorkflowChildMetaSchema.safeParse(parsed);
  if (!result.success) return null;
  const meta = result.data;
  const hasAnyField = Object.values(meta).some((value) => value !== undefined);
  return hasAnyField ? meta : null;
}

/**
 * Read a run's `workflowProgress`, ignoring the phase markers interleaved with the agents.
 *
 * Accepts the whole run summary rather than the array so callers need not know that the field is
 * where the per-child facts live.
 */
export function parseWorkflowProgressAgents(result: unknown): ClaudeWorkflowProgressAgent[] {
  const progress = toRecord(result)?.workflowProgress;
  if (!Array.isArray(progress)) return [];
  return progress.flatMap((entry) => {
    const parsed = WorkflowProgressAgentSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * Merge a run's journal, sidecar metas and progress entries into one child per agent id.
 *
 * Order is the journal's: it is the only source written as the run happens, so it alone reflects
 * the order the children actually started. Sources are layered rather than chosen between —
 * a live run has a journal and metas but no summary, a replayed one has all three — so each field
 * takes the most specific value any source offered and no source has to be complete.
 */
export function collectWorkflowChildren(input: {
  journal?: string;
  metaByAgentId?: ReadonlyMap<string, ClaudeWorkflowChildMeta>;
  progress?: readonly ClaudeWorkflowProgressAgent[];
}): ClaudeWorkflowChild[] {
  const children = new Map<string, ClaudeWorkflowChild>();
  const upsert = (agentId: string): ClaudeWorkflowChild => {
    const existing = children.get(agentId);
    if (existing) return existing;
    const created: ClaudeWorkflowChild = { agentId, finished: false };
    children.set(agentId, created);
    return created;
  };

  applyJournal(input.journal, upsert);
  applyMeta(input.metaByAgentId, children);
  applyProgress(input.progress, upsert);
  return [...children.values()];
}

/** The journal declares the run's children and records their outcomes, in the order they began. */
function applyJournal(
  journal: string | undefined,
  upsert: (agentId: string) => ClaudeWorkflowChild,
): void {
  for (const line of (journal ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = safeParseJson(line);
    if (parsed === undefined) continue;
    const entry = WorkflowJournalLineSchema.safeParse(parsed);
    if (!entry.success) continue;
    const child = upsert(entry.data.agentId);
    if (entry.data.type === "started") {
      child.label = readString(entry.data.label) ?? child.label;
      child.phase = readString(entry.data.phase) ?? child.phase;
      continue;
    }
    child.finished = true;
    child.result = readString(entry.data.result) ?? child.result;
  }
}

/**
 * Sidecars fill gaps the journal left, for the agents this run launched and no others.
 *
 * The walk that produces these metas is session-wide, so an unfiltered merge would hang every
 * other workflow's children off this run. A child whose journal line has not landed yet is one
 * poll away, not missing.
 */
function applyMeta(
  metaByAgentId: ReadonlyMap<string, ClaudeWorkflowChildMeta> | undefined,
  children: Map<string, ClaudeWorkflowChild>,
): void {
  for (const [agentId, meta] of metaByAgentId ?? new Map()) {
    const child = children.get(agentId);
    if (!child) continue;
    child.label = child.label ?? readString(meta.description);
    child.phase = child.phase ?? readString(meta.workflowPhase);
    if (child.model) continue;
    const metaModel = resolveObservedClaudeModelId(readString(meta.model));
    if (metaModel) child.model = metaModel;
  }
}

/** The finished run's summary, which is the most specific source for every field it carries. */
function applyProgress(
  progress: readonly ClaudeWorkflowProgressAgent[] | undefined,
  upsert: (agentId: string) => ClaudeWorkflowChild,
): void {
  for (const agent of progress ?? []) {
    const child = upsert(agent.agentId);
    child.label = readString(agent.label) ?? child.label;
    child.phase = readString(agent.phaseTitle) ?? child.phase;
    const progressModel = resolveObservedClaudeModelId(readString(agent.model));
    if (progressModel) child.model = progressModel;
    child.state = readString(agent.state) ?? child.state;
    child.startedAt = agent.startedAt ?? child.startedAt;
    if (typeof agent.tokens === "number") child.totalTokens = agent.tokens;
    child.description = readString(agent.promptPreview) ?? child.description;
    child.result = child.result ?? readString(agent.resultPreview);
    child.lastActivity =
      formatLastActivity(agent.lastToolName, agent.lastToolSummary) ?? child.lastActivity;
  }
}

/**
 * Claude's `workflowProgress` state, as a Frogg status.
 *
 * Unrecognized states read as running rather than failed: this is the live-ish source, and a
 * state Frogg has not seen before is far more likely to be another word for work in progress than
 * evidence the child broke. The terminal word Frogg does trust — a journal result line — arrives
 * separately and settles the row either way.
 */
function mapWorkflowChildState(state: string | undefined): ProviderSubagentStatus | undefined {
  switch (state?.trim().toLowerCase()) {
    case "done":
    case "completed":
    case "success":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    case "canceled":
    case "cancelled":
    case "killed":
    case "stopped":
    case "skipped":
      return "canceled";
    case "queued":
    case "pending":
    case "running":
    case "active":
      return "running";
    default:
      return undefined;
  }
}

export interface ObserveWorkflowChildrenInput {
  /** The Workflow row these children hang beneath. */
  workflowSubagentId: string;
  children: readonly ClaudeWorkflowChild[];
  /** Each child's own transcript entries, so its pane reads like any other subagent's. */
  entriesByAgentId?: ReadonlyMap<string, readonly ClaudeReplayEntry[]>;
  convertEntry?: (entry: ClaudeReplayEntry) => AgentTimelineItem[];
  /**
   * Whether a child with no recorded outcome should be terminalized.
   *
   * True on replay: the run that owned these children cannot still be producing them after the
   * provider runtime was recreated, so a row left running could never receive another update.
   * False while polling a live run, where "no result yet" is the accurate answer.
   */
  terminalizeRunning?: boolean;
}

/**
 * Turn merged children into the same observation vocabulary every other subagent source speaks.
 *
 * Pure, and safe to call repeatedly over a growing run directory: the store's sticky merge makes a
 * re-declaration idempotent, so the live poller can re-observe the whole run each tick rather than
 * track what it has already emitted. Timeline items are the exception — they append — so callers
 * polling a live run pass only the entries they have not converted before.
 */
export function observeWorkflowChildren(
  input: ObserveWorkflowChildrenInput,
): SubagentObservation[] {
  const observations: SubagentObservation[] = [];

  for (const child of input.children) {
    const id = workflowChildSubagentId(input.workflowSubagentId, child.agentId);
    const startedAt = normalizeEpochTimestamp(child.startedAt);
    // The label ("server-a") is what distinguishes a child from its siblings, so it names the row.
    // The phase ("Fix") is shared across the fan-out and belongs in the subtitle instead.
    const title = child.label ?? child.agentId;
    const description = truncate(child.description, MAX_CHILD_DESCRIPTION_CHARS);

    observations.push({
      kind: "declared",
      id,
      parentId: input.workflowSubagentId,
      title,
      ...(description ? { description } : {}),
      ...(startedAt ? { timestamp: startedAt } : {}),
    });

    const subtitle = buildClaudeSubagentSubtitle({
      ...(child.phase ? { title: child.phase } : {}),
      ...(child.model ? { model: child.model } : {}),
      ...(typeof child.totalTokens === "number"
        ? { usage: { totalTokens: child.totalTokens } }
        : {}),
    });
    const trailing = [subtitle, child.lastActivity].filter((part): part is string => !!part);
    if (trailing.length > 0) {
      observations.push({ kind: "subtitle", id, subtitle: trailing.join(" · ") });
    }

    observations.push(
      ...observeChildTimeline({
        id,
        entries: input.entriesByAgentId?.get(child.agentId) ?? [],
        convertEntry: input.convertEntry,
        result: child.result,
      }),
    );

    const status = resolveChildStatus(child, input.terminalizeRunning === true);
    if (status) observations.push({ kind: "status", id, status });
  }

  return observations;
}

/**
 * The run summary's explicit state wins over the journal's structural one: it can tell a failure
 * from a success, where a result line only proves the child stopped.
 */
function resolveChildStatus(
  child: ClaudeWorkflowChild,
  terminalizeRunning: boolean,
): ProviderSubagentStatus | undefined {
  const declared = mapWorkflowChildState(child.state);
  if (declared) return declared;
  if (child.finished) return "completed";
  return terminalizeRunning ? "failed" : "running";
}

function observeChildTimeline(input: {
  id: string;
  entries: readonly ClaudeReplayEntry[];
  convertEntry?: (entry: ClaudeReplayEntry) => AgentTimelineItem[];
  result?: string;
}): SubagentObservation[] {
  const observations: SubagentObservation[] = [];
  const replayedAssistantText = new Set<string>();
  const entries = [...input.entries].sort(compareReplayTimestamps);

  for (const entry of entries) {
    const timestamp = normalizeProviderReplayTimestamp(entry.timestamp);
    for (const item of input.convertEntry?.(entry) ?? []) {
      if (item.type === "assistant_message") replayedAssistantText.add(item.text.trim());
      observations.push({
        kind: "timeline",
        id: input.id,
        item,
        ...(timestamp ? { timestamp } : {}),
      });
    }
  }

  // The recorded outcome is a summary of the transcript, not an extra turn. Appending it after a
  // transcript that already ends with it would show the child answering twice.
  const result = input.result?.trim();
  if (!result || replayedAssistantText.has(result)) return observations;
  observations.push({
    kind: "timeline",
    id: input.id,
    item: { type: "assistant_message", text: result },
  });
  return observations;
}

function compareReplayTimestamps(a: ClaudeReplayEntry, b: ClaudeReplayEntry): number {
  const aTimestamp = normalizeProviderReplayTimestamp(a.timestamp);
  const bTimestamp = normalizeProviderReplayTimestamp(b.timestamp);
  if (!aTimestamp && !bTimestamp) return 0;
  if (!aTimestamp) return 1;
  if (!bTimestamp) return -1;
  return Date.parse(aTimestamp) - Date.parse(bTimestamp);
}

function formatLastActivity(name: unknown, summary: unknown): string | undefined {
  const toolName = readString(name);
  const toolSummary = readString(summary);
  if (!toolName) return toolSummary;
  return toolSummary ? `${toolName}: ${toolSummary}` : toolName;
}

function truncate(value: string | undefined, max: number): string | undefined {
  const text = readString(value);
  if (!text) return undefined;
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`;
}

function normalizeEpochTimestamp(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function safeParseJson(contents: string): unknown {
  try {
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
