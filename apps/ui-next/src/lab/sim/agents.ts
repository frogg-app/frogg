// Simulated subagents for the lab: a session's spawned children, with the running one streaming
// activity through `agent.provider_subagents.update` upserts like a real Claude host.
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

let epoch = 0;
const live = new Map<string, ReturnType<typeof subagents>[number]>();

/** Stops activity streams from an earlier demo (called on every lab reseed). */
export function resetSubagents(): void {
  epoch += 1;
  live.clear();
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
  }
}

export function makeListProviderSubagents(emit: Emit) {
  return async (parentAgentId: string) => {
    await latency(220);
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
