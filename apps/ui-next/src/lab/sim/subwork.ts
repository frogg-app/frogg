// Simulated sub-work for the lab: one working session ("Interface redesign") whose subagents,
// scripts, terminals, background commands and child sessions start, progress, finish and fail on
// demand or on a timer. Everything goes through the same paths as a real host: subagent upserts
// as `agent.provider_subagents.update`, script status as `script_status_update`, terminals as
// `terminals_changed`, child sessions as labelled sessions, background commands as timeline
// tool calls. So the real store, hook and views are what the lab exercises.
import { ensureLive, loadSubagents, loadTerminals } from "../../daemon/subwork";
import { useDaemon } from "../../daemon/store";
import type { Agent } from "../../daemon/types";
import { labFeature } from "../client";
import { agent as makeAgent, entry, ID, toolItem } from "../fixtures";
import { seedRows, simRows, simTerminals } from "./agents";
import { emitRaw } from "./index";

export const SIM_SESSION = ID.working;
const WS = "ws-sim";
const CWD = "/home/dev/frogg-sim";
const PARENT_LABEL = "frogg.parent-agent-id";

type Row = ReturnType<typeof seedRows>[number];

const NAMES = ["Explore", "ui-next-dev", "general-purpose", "docs-writer", "test-runner"];
const TASKS = [
  "Find cache eviction callers",
  "Session cache settings page",
  "Benchmark eviction under 10k sessions",
  "Document sessionCache.maxEntries",
  "Run the daemon unit tests",
];
const ACTIVITY = [
  "Grep · evictOldest|entries.clear\\(",
  "Read · packages/server/src/session.ts",
  "Glob · packages/server/src/**/*.test.ts",
  "Read · packages/server/src/store/agent-store.ts",
  "Bash · npm run test -- session-store",
  "Edit · packages/server/src/session-cache.ts",
];
const SCRIPT_NAMES = ["dev", "storybook", "api", "docs"];
const COMMANDS = ["npm run build:watch", "sleep 45 && npm run e2e", "tail -f logs/daemon.log"];

let n = 0;
let epoch = 0;
const now = () => new Date().toISOString();

interface Script {
  scriptName: string;
  type: "script" | "service";
  hostname: string;
  port: number | null;
  lifecycle: "running" | "stopped";
  health: "healthy" | "unhealthy" | null;
  exitCode: number | null;
  terminalId: string | null;
  proxyUrl: string | null;
}
let scripts: Script[] = [];
let terms: Array<{
  id: string;
  name: string;
  title?: string;
  activity: { state: string; attentionReason?: string | null; changedAt: number } | null;
}> = [];

const rows = (): Row[] => simRows.get(SIM_SESSION) ?? [];
const upsert = (row: Row) => {
  // An older daemon never pushes subagent updates.
  if (!labFeature("providerSubagents")) return;
  emitRaw({
    type: "agent.provider_subagents.update",
    payload: { kind: "upsert", subagent: { ...row } },
  });
};
const setRows = (next: Row[]) => simRows.set(SIM_SESSION, next);

function patchSession(patch: Partial<Agent>): void {
  useDaemon.setState((st) => {
    const sess = st.sessions[SIM_SESSION];
    if (!sess) return {};
    return {
      sessions: { ...st.sessions, [SIM_SESSION]: { ...sess, agent: { ...sess.agent, ...patch } } },
    };
  });
}

function pushScripts(): void {
  emitRaw({ type: "script_status_update", payload: { workspaceId: WS, scripts } });
}
function pushTerms(): void {
  simTerminals.set(CWD, terms);
  emitRaw({ type: "terminals_changed", payload: { cwd: CWD, terminals: terms } });
}

/** Resets to the demo's starting state and primes the store: subagents, a script, a terminal. */
export function simReset(): void {
  epoch += 1;
  n = 0;
  scripts = [];
  terms = [];
  setRows([]);
  // Drop children from an earlier run, then give the session its own workspace and cwd.
  useDaemon.setState((st) => ({
    sessions: Object.fromEntries(
      Object.entries(st.sessions).filter(([, x]) => !x.agent.id.startsWith("s-sim-child")),
    ),
  }));
  patchSession({ workspaceId: WS, cwd: CWD });
  ensureLive();
  simStartSubagent("Explore", 80_000);
  simDone();
  simStartSubagent("ui-next-dev", 25_000);
  simStartScript("dev", 3000);
  simOpenTerminal();
  loadSubagents(SIM_SESSION, true);
  loadTerminals(CWD, true);
}

export function simStartSubagent(name?: string, agoMs = 0): void {
  n += 1;
  const i = n % NAMES.length;
  const created = new Date(Date.now() - agoMs).toISOString();
  const row = {
    ...seedRows(SIM_SESSION)[0],
    id: `${SIM_SESSION}-sim-${n}`,
    title: name ?? NAMES[i],
    description: TASKS[i],
    status: "running" as const,
    createdAt: created,
    updatedAt: now(),
    toolCallId: `call-sim-${n}`,
    subtitle: ACTIVITY[n % ACTIVITY.length],
  } as Row;
  setRows([...rows(), row]);
  upsert(row);
}

function settle(status: "completed" | "failed"): void {
  const run = rows().find((x) => x.status === "running");
  if (!run) return;
  const next = {
    ...run,
    status,
    updatedAt: now(),
    subtitle: status === "failed" ? "Bash exited 1 · test run failed" : "Done · 4 files changed",
  } as Row;
  setRows(rows().map((x) => (x.id === run.id ? next : x)));
  upsert(next);
}
export const simDone = () => settle("completed");
export const simFail = () => settle("failed");

/** A new service script on the next free port, or a one-shot script. */
export function simStartScript(name?: string, port?: number): void {
  const idx = scripts.length;
  const scriptName = name ?? SCRIPT_NAMES[idx % SCRIPT_NAMES.length];
  scripts = [
    ...scripts.filter((x) => x.scriptName !== scriptName),
    {
      scriptName,
      type: "service",
      hostname: `${scriptName}.localhost`,
      port: port ?? 3000 + idx * 111,
      lifecycle: "running",
      health: "healthy",
      exitCode: null,
      terminalId: null,
      proxyUrl: null,
    },
  ];
  pushScripts();
}
export function simStopScript(): void {
  const run = scripts.find((x) => x.lifecycle === "running");
  if (!run) return;
  scripts = scripts.map((x) =>
    x === run ? Object.assign({}, x, { lifecycle: "stopped" as const }) : x,
  );
  pushScripts();
}
export function simSickScript(): void {
  const run = scripts.find((x) => x.lifecycle === "running" && x.health === "healthy");
  if (!run) return;
  scripts = scripts.map((x) =>
    x === run ? Object.assign({}, x, { health: "unhealthy" as const }) : x,
  );
  pushScripts();
}

export function simOpenTerminal(): void {
  const i = terms.length + 1;
  terms = [
    ...terms,
    {
      id: `sim-term-${i}`,
      name: `bash ${i}`,
      title: i === 1 ? "npm run dev" : `bash ${i}`,
      activity: { state: "working", changedAt: Date.now() },
    },
  ];
  pushTerms();
}
/** The first working terminal asks for input (attention), then the next press finishes it. */
export function simTerminalStep(): void {
  const t = terms.find((x) => x.activity?.state === "working");
  const waiting = terms.find((x) => x.activity?.attentionReason === "needs_input");
  if (waiting) {
    terms = terms.map((x) =>
      x === waiting
        ? Object.assign({}, x, { activity: { state: "idle", changedAt: Date.now() } })
        : x,
    );
  } else if (t) {
    terms = terms.map((x) =>
      x === t
        ? Object.assign({}, x, {
            activity: { state: "attention", attentionReason: "needs_input", changedAt: Date.now() },
          })
        : x,
    );
  }
  pushTerms();
}

export function simSpawnChild(): void {
  n += 1;
  const id = `s-sim-child-${n}`;
  const a = makeAgent({
    id,
    title: `Child: ${TASKS[n % TASKS.length]}`,
    status: "running",
    cwd: CWD,
    labels: { [PARENT_LABEL]: SIM_SESSION },
    updatedAt: now(),
    createdAt: now(),
  });
  useDaemon.setState((st) => ({ sessions: { ...st.sessions, [id]: { agent: a, project: null } } }));
}
export function simChildSettle(failed: boolean): void {
  const kid = Object.values(useDaemon.getState().sessions).find(
    (x) => x.agent.id.startsWith("s-sim-child") && x.agent.status === "running",
  );
  if (!kid) return;
  const patch: Partial<Agent> = failed
    ? { status: "error", attentionReason: "error", requiresAttention: true, updatedAt: now() }
    : { status: "idle", attentionReason: "finished", requiresAttention: true, updatedAt: now() };
  useDaemon.setState((st) => ({
    sessions: { ...st.sessions, [kid.agent.id]: { ...kid, agent: { ...kid.agent, ...patch } } },
  }));
}

/** A backgrounded shell: the tool call that started it, later a task notification that ends it. */
let bgOpen: string[] = [];
export function simStartBackground(): void {
  n += 1;
  const id = `bgsim${n}`;
  const cmd = COMMANDS[n % COMMANDS.length];
  bgOpen = [...bgOpen, id];
  const item = toolItem(`call-bg-${n}`, "Bash", {
    type: "shell",
    command: cmd,
    output: `Command running in background with ID: ${id}. Output is being written to /tmp/${id}.output`,
    exitCode: 0,
  });
  useDaemon.setState((st) => ({
    timelines: {
      ...st.timelines,
      [SIM_SESSION]: [...(st.timelines[SIM_SESSION] ?? []), entry(item)],
    },
  }));
}
export function simEndBackground(failed: boolean): void {
  const id = bgOpen[0];
  if (!id) return;
  bgOpen = bgOpen.slice(1);
  const item = toolItem(
    `task_notification_${id}`,
    "Background task",
    {
      type: "plain_text",
      label: failed ? "Background task failed" : "Background task completed",
      text: "",
    } as never,
    failed ? "failed" : "completed",
  );
  useDaemon.setState((st) => ({
    timelines: {
      ...st.timelines,
      [SIM_SESSION]: [...(st.timelines[SIM_SESSION] ?? []), entry(item)],
    },
  }));
}

/** Finishes whatever is running, preferring subagents, then background, children, terminals. */
export function simFinishAny(failed: boolean): void {
  if (rows().some((x) => x.status === "running")) {
    if (failed) simFail();
    else simDone();
  } else if (bgOpen.length) simEndBackground(failed);
  else if (
    Object.values(useDaemon.getState().sessions).some(
      (x) => x.agent.id.startsWith("s-sim-child") && x.agent.status === "running",
    )
  )
    simChildSettle(failed);
  else simStopScript();
}

const STARTS = [
  () => simStartSubagent(),
  () => simStartSubagent(),
  simStartBackground,
  simSpawnChild,
  simStartScript,
  simOpenTerminal,
];

/** One random step of a plausible session: starts are likelier while little runs. */
export function simStep(): void {
  const running = rows().filter((x) => x.status === "running").length + bgOpen.length;
  const roll = Math.random();
  if (running < 2 || roll < 0.35) STARTS[Math.floor(Math.random() * STARTS.length)]();
  else if (roll < 0.55) simFinishAny(false);
  else if (roll < 0.65) simFinishAny(true);
  else if (roll < 0.8) simTerminalStep();
  else simProgress();
}

/** Moves the running subagents' activity line along. */
export function simProgress(): void {
  const next = rows().map((x, i) =>
    x.status === "running"
      ? Object.assign({}, x, {
          subtitle: ACTIVITY[(n + i + Math.floor(Date.now() / 2000)) % ACTIVITY.length],
          updatedAt: now(),
        })
      : x,
  );
  setRows(next);
  for (const r of next) if (r.status === "running") upsert(r);
}

export const simEpoch = () => epoch;
