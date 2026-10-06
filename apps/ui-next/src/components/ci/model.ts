// CI run model shared by the PRs & CI panel, the run detail pane and the lab simulator.
import { useEffect, useState } from "react";
import { create } from "zustand";
import type { getClient } from "../../daemon/store";

type Client = NonNullable<ReturnType<typeof getClient>>;
export type CiList = Awaited<ReturnType<Client["checkoutCiListRuns"]>>;
type WireRun = CiList["runs"][number];
type WireJob = WireRun["jobs"][number];

/**
 * A job as the panel reads it. `log` (the failing step's last lines) and `attempt` are not on
 * the wire yet; fixtures fill them and a daemon that adds them lights the UI up unchanged.
 */
export type CiJob = WireJob & { log?: string[]; attempt?: number };
/** A run plus the commit facts the protocol does not carry yet (title, actor, sha, attempt). */
export type CiRun = Omit<WireRun, "jobs"> & {
  jobs: CiJob[];
  title?: string;
  actor?: string;
  sha?: string;
  attempt?: number;
};

/** Glyph states: the five check states plus a separate cancelled. */
export type CiState = "ok" | "fail" | "run" | "wait" | "skip" | "cancel";

/** Collapses forge-specific check and run states onto the five the design has glyphs for. */
export function stateOf(status: string): Exclude<CiState, "cancel"> {
  const v = status.toLowerCase();
  if (/skip|neutral/.test(v)) return "skip";
  if (/success|pass|completed/.test(v)) return "ok";
  if (/fail|error|cancel|timed_out|action_required/.test(v)) return "fail";
  if (/progress|running|in_progress/.test(v)) return "run";
  return "wait";
}

/** Like `stateOf`, but a cancelled run reads as cancelled rather than failed. */
export const ciState = (status: string): CiState =>
  /cancel/i.test(status) ? "cancel" : stateOf(status);

export const isDone = (st: CiState) => st !== "run" && st !== "wait";

/** Run 0..1: the provider's figure, else jobs averaged (finished = 1, running = its progress). */
export function runProgress(run: CiRun): number {
  if (run.progress !== null) return run.progress;
  if (!run.jobs.length) return isDone(ciState(run.status)) ? 1 : 0;
  const sum = run.jobs.reduce((n, j) => {
    const st = ciState(j.status);
    if (isDone(st)) return n + 1;
    return n + (st === "run" ? (j.progress ?? 0) : 0);
  }, 0);
  return sum / run.jobs.length;
}

/** Seconds between two ISO stamps (now when still open); null before it starts. */
export function seconds(a: string | null, b: string | null, now = Date.now()): number | null {
  if (!a) return null;
  return Math.max(0, ((b ? Date.parse(b) : now) - Date.parse(a)) / 1000);
}

/** 42s · 3m 02s · 1h 04m. Rounds the in-between values a lerp passes through. */
export function dur(sec: number): string {
  const n = Math.max(0, Math.round(sec));
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`;
  return `${Math.floor(n / 3600)}h ${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}m`;
}

/** Remaining seconds from elapsed and progress; null until there is enough basis to guess. */
export function eta(elapsed: number | null, progress: number | null): number | null {
  if (elapsed === null || progress === null || progress < 0.08 || progress >= 1) return null;
  return (elapsed / progress) * (1 - progress);
}

/** The step a job is on (running) or stopped at (failed), 1-based, with its name. */
export function currentStep(job: CiJob): { n: number; of: number; name: string } | null {
  const want = ciState(job.status) === "fail" ? "fail" : "run";
  const at = job.steps.findIndex((st) => ciState(st.status) === want);
  if (at < 0) return null;
  return { n: at + 1, of: job.steps.length, name: job.steps[at]?.name ?? "" };
}

/** Rerun and cancel are not daemon RPCs yet; whoever can perform them (the lab) registers here. */
export interface CiActions {
  rerun?: (runId: string, failedOnly: boolean) => void | Promise<void>;
  cancel?: (runId: string) => void | Promise<void>;
}

interface CiStore {
  runs: CiRun[];
  /** Null until the first listing lands. */
  list: Omit<CiList, "runs"> | null;
  open: string | null;
  actions: CiActions;
}

export const useCi = create<CiStore>(() => ({ runs: [], list: null, open: null, actions: {} }));
export const setCiRuns = (runs: CiRun[]) => useCi.setState({ runs });
export const openCiRun = (id: string | null) => useCi.setState({ open: id });

/** A wall clock that ticks every `ms` while `live`, so open durations keep counting. */
export function useNow(live: boolean, ms = 1000): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!live) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [live, ms]);
  return now;
}
