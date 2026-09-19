import type { CiJob as WireCiJob, CiRun as WireCiRun } from "@frogg/protocol/messages";

export type CiProvider = "githubActions" | "jenkins" | "other";
export type CiStatus = "queued" | "running" | "success" | "failure" | "cancelled" | "skipped";

export interface CiStep {
  name: string;
  status: CiStatus;
}

export interface CiRunner {
  name: string;
  hosted: boolean;
  labels: string[];
}

export interface CiJob {
  id: string;
  name: string;
  status: CiStatus;
  /** 0..1, or null when the provider gives nothing to estimate from. */
  progress: number | null;
  startedAt: number | null;
  completedAt: number | null;
  url: string | null;
  runner: CiRunner | null;
  steps: CiStep[];
}

export interface CiRun {
  id: string;
  provider: CiProvider;
  pipeline: string;
  number: number | null;
  trigger: string | null;
  status: CiStatus;
  progress: number | null;
  startedAt: number | null;
  completedAt: number | null;
  url: string | null;
  jobs: CiJob[];
}

const KNOWN_STATUSES: readonly CiStatus[] = [
  "queued",
  "running",
  "success",
  "failure",
  "cancelled",
  "skipped",
];

/** The wire carries open strings so a newer daemon can add states; unknown ones read as queued. */
export function normalizeCiStatus(value: string): CiStatus {
  return (KNOWN_STATUSES as readonly string[]).includes(value) ? (value as CiStatus) : "queued";
}

function normalizeProvider(value: string): CiProvider {
  return value === "githubActions" || value === "jenkins" ? value : "other";
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeJob(job: WireCiJob): CiJob {
  return {
    id: job.id,
    name: job.name,
    status: normalizeCiStatus(job.status),
    progress: job.progress,
    startedAt: parseTime(job.startedAt),
    completedAt: parseTime(job.completedAt),
    url: job.url,
    runner: job.runner,
    steps: job.steps.map((step) => ({ name: step.name, status: normalizeCiStatus(step.status) })),
  };
}

export function normalizeCiRun(run: WireCiRun): CiRun {
  return {
    id: run.id,
    provider: normalizeProvider(run.provider),
    pipeline: run.pipeline,
    number: run.number,
    trigger: run.trigger,
    status: normalizeCiStatus(run.status),
    progress: run.progress,
    startedAt: parseTime(run.startedAt),
    completedAt: parseTime(run.completedAt),
    url: run.url,
    jobs: run.jobs.map(normalizeJob),
  };
}

export function isCiActive(status: CiStatus): boolean {
  return status === "running" || status === "queued";
}

/** Wall time from start to finish, or to now while it is still going. */
export function elapsedMs(
  item: { startedAt: number | null; completedAt: number | null },
  now: number,
): number | null {
  if (item.startedAt === null) return null;
  return Math.max(0, (item.completedAt ?? now) - item.startedAt);
}

export function formatCiDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export interface RunnerUse {
  runner: CiRunner;
  job: CiJob | null;
}

/** Each runner once: busy with the job it is running, otherwise idle. */
export function collectRunners(runs: CiRun[]): RunnerUse[] {
  const byName = new Map<string, RunnerUse>();
  for (const run of runs) {
    for (const job of run.jobs) {
      if (!job.runner) continue;
      if (job.status === "running") byName.set(job.runner.name, { runner: job.runner, job });
      else if (!byName.has(job.runner.name)) {
        byName.set(job.runner.name, { runner: job.runner, job: null });
      }
    }
  }
  return [...byName.values()];
}
