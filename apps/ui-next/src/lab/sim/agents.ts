// Simulated subagents for the lab: a session's spawned children, with the running one streaming
// activity through `agent.provider_subagents.update` upserts like a real Claude host.
import type { TimelineItem } from "../../daemon/types";
import { toolDetails, toolItem } from "../fixtures";
import { latency, labWait } from "./time";

type Emit = (event: unknown) => void;
type Status = "running" | "completed" | "failed" | "canceled";

const MIN = 60_000;
const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

const ACTIVITY = [
  "Grep · evictOldest|entries.clear\\(",
  "Read · packages/server/src/session.ts",
  "Grep · new SessionStore\\(",
  "Read · packages/server/src/daemon.ts",
  "Glob · packages/server/src/**/*.test.ts",
  "Read · packages/server/src/store/agent-store.ts",
];

function subagents(parent: string) {
  const base = (
    id: string,
    title: string,
    description: string,
    status: Status,
    startedMsAgo: number,
    updatedMsAgo: number,
    subtitle: string,
  ) => ({
    id: `${parent}-${id}`,
    parentAgentId: parent,
    provider: "claude" as const,
    title,
    description,
    status,
    createdAt: at(startedMsAgo),
    updatedAt: at(updatedMsAgo),
    toolCallId: `call-${id}`,
    cwd: "/home/dev/frogg",
    subtitle,
    parentSubagentId: null,
  });
  return [
    base(
      "explore",
      "Explore",
      "Find cache eviction callers",
      "running",
      1.4 * MIN,
      2000,
      ACTIVITY[0],
    ),
    base(
      "settings",
      "ui-next-dev",
      "Session cache settings page",
      "completed",
      9 * MIN,
      3 * MIN,
      "Done · 4 files changed · 12 tool calls",
    ),
    base(
      "bench",
      "general-purpose",
      "Benchmark eviction under 10k sessions",
      "failed",
      6 * MIN,
      5 * MIN,
      "Bash exited 137 · out of memory",
    ),
    base(
      "docs",
      "docs-writer",
      "Document sessionCache.maxEntries",
      "canceled",
      4 * MIN,
      4 * MIN,
      "Canceled before start",
    ),
  ];
}

/** Sub-work lab demo (sim/subwork.ts) owns these parents' rows: the list returns them verbatim. */
export const simRows = new Map<string, ReturnType<typeof subagents>>();
/** Terminals the sub-work demo reports per cwd; other cwds fall back to the lab's own terminals. */
export const simTerminals = new Map<string, unknown[]>();
export const seedRows = subagents;

let epoch = 0;
const live = new Map<string, ReturnType<typeof subagents>[number]>();
/** Activity rows per subagent id, grown by the running one's stream. */
const timelines = new Map<string, Array<{ item: TimelineItem; timestamp: string; seq: number }>>();

/** A plausible transcript for a subagent: its brief, a few tool calls, and how it ended. */
function script(id: string, description: string, status: Status, subtitle: string): TimelineItem[] {
  const items: TimelineItem[] = [
    { type: "user_message", text: description, messageId: `${id}-u` } as TimelineItem,
    toolItem(`${id}-t1`, "Grep", toolDetails.search),
    toolItem(`${id}-t2`, "Read", toolDetails.read),
  ];
  if (status === "completed")
    items.push(toolItem(`${id}-t3`, "Edit", toolDetails.edit), {
      type: "assistant_message",
      text: `Finished. ${subtitle}.`,
      messageId: `${id}-a`,
    } as TimelineItem);
  if (status === "failed")
    items.push(toolItem(`${id}-t3`, "Bash", toolDetails.shellFailed, "failed", "exit code 137"), {
      type: "error",
      message: subtitle,
    } as TimelineItem);
  if (status === "running")
    items.push({
      type: "assistant_message",
      text: "Tracing the callers of the eviction path before changing anything.",
      messageId: `${id}-a`,
    } as TimelineItem);
  return status === "canceled" ? items.slice(0, 1) : items;
}

function rowsFor(row: ReturnType<typeof subagents>[number]) {
  let rows = timelines.get(row.id);
  if (!rows) {
    const t0 = Date.parse(row.createdAt);
    rows = script(row.id, row.description, row.status, row.subtitle).map((item, i) => ({
      item,
      timestamp: new Date(t0 + i * 4000).toISOString(),
      seq: i + 1,
    }));
    timelines.set(row.id, rows);
  }
  return rows;
}

/** Stops activity streams from an earlier demo (called on every lab reseed). */
export function resetSubagents(): void {
  epoch += 1;
  live.clear();
  timelines.clear();
  simRows.clear();
  simTerminals.clear();
}

async function stream(parent: string, emit: Emit, mine: number): Promise<void> {
  let step = 0;
  for (;;) {
    await labWait(2200);
    const row = live.get(parent);
    if (epoch !== mine || !row) return;
    step += 1;
    row.subtitle = ACTIVITY[step % ACTIVITY.length];
    row.updatedAt = new Date().toISOString();
    emit({
      type: "agent.provider_subagents.update",
      payload: { kind: "upsert", subagent: { ...row } },
    });
    // The same step lands in the subagent's own timeline, as a finished tool call.
    const rows = rowsFor(row);
    const [tool, arg] = row.subtitle.split(" · ");
    const next = {
      item: toolItem(`${row.id}-s${step}`, tool, {
        ...toolDetails.search,
        query: arg,
      } as typeof toolDetails.search),
      timestamp: row.updatedAt,
      seq: rows.length + 1,
    };
    rows.push(next);
    emit({
      type: "agent.provider_subagents.update",
      payload: {
        kind: "timeline",
        parentAgentId: parent,
        subagentId: row.id,
        provider: "claude",
        epoch: "lab",
        ...next,
      },
    });
  }
}

export function makeListProviderSubagents(emit: Emit) {
  return async (parentAgentId: string) => {
    await latency(220);
    const owned = simRows.get(parentAgentId);
    if (owned)
      return {
        requestId: "lab",
        parentAgentId,
        subagents: [...owned],
        error: null,
      };
    const rows = subagents(parentAgentId);
    if (!live.has(parentAgentId)) {
      live.set(parentAgentId, rows[0]);
      void stream(parentAgentId, emit, epoch);
    }
    const running = live.get(parentAgentId);
    return {
      requestId: "lab",
      parentAgentId,
      subagents: running ? [{ ...running }, ...rows.slice(1)] : rows,
      error: null,
    };
  };
}

export function makeFetchProviderSubagentTimeline() {
  return async (parentAgentId: string, subagentId: string) => {
    await latency(650);
    const row =
      live.get(parentAgentId)?.id === subagentId
        ? live.get(parentAgentId)
        : [...(simRows.get(parentAgentId) ?? []), ...subagents(parentAgentId)].find(
            (x) => x.id === subagentId,
          );
    const rows = row ? rowsFor(row) : [];
    const maxSeq = rows.length;
    return {
      requestId: "lab",
      parentAgentId,
      subagentId,
      provider: "claude",
      direction: "tail",
      epoch: "lab",
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: maxSeq ? 1 : 0, maxSeq, nextSeq: maxSeq + 1 },
      hasOlder: false,
      hasNewer: false,
      rows: [...rows],
      error: row ? null : "no such subagent",
    };
  };
}
