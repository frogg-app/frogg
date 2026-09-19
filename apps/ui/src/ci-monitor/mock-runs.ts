/**
 * DESIGN PROTOTYPE. Simulated CI runs so the sidebar bars and the explorer's CI tab can be
 * judged in the real app before any daemon or provider work exists. Nothing here talks to
 * GitHub Actions or Jenkins.
 *
 * Every run is a pure function of the workspace id and the clock: each job has an offset and a
 * duration inside a repeating cycle, so every surface asking at the same moment agrees, and a
 * preview left open keeps moving through queued, running and finished without any state.
 */
import { useEffect, useState } from "react";

export type CiProvider = "githubActions" | "jenkins";
export type CiStatus = "queued" | "running" | "success" | "failure";

export interface CiStep {
  name: string;
  status: CiStatus;
}

export interface CiRunner {
  name: string;
  /** GitHub-hosted or a Jenkins controller's built-in pool, as opposed to our own machines. */
  hosted: boolean;
  labels: string[];
}

export interface CiJob {
  id: string;
  name: string;
  status: CiStatus;
  /** 0..1 */
  progress: number;
  elapsedMs: number;
  runner: CiRunner | null;
  steps: CiStep[];
}

export interface CiRun {
  id: string;
  provider: CiProvider;
  pipeline: string;
  number: number;
  trigger: string;
  status: CiStatus;
  progress: number;
  elapsedMs: number;
  jobs: CiJob[];
}

interface JobSpec {
  name: string;
  /** Seconds into the cycle the job starts, and how long it takes. */
  start: number;
  duration: number;
  runner: CiRunner;
  steps: string[];
  fails?: boolean;
}

interface RunSpec {
  provider: CiProvider;
  pipeline: string;
  number: number;
  trigger: string;
  cycle: number;
  phase: number;
  jobs: JobSpec[];
}

const GH_UBUNTU: CiRunner = { name: "ubuntu-latest", hosted: true, labels: ["linux", "x64"] };
const GH_MAC: CiRunner = { name: "macos-14", hosted: true, labels: ["macos", "arm64"] };
const WIN_SELF: CiRunner = { name: "frogg-win-01", hosted: false, labels: ["windows", "x64"] };
const ANDROID_SELF: CiRunner = {
  name: "frogg-build-02",
  hosted: false,
  labels: ["linux", "android"],
};
const JK_LINUX: CiRunner = { name: "agent-linux-2", hosted: false, labels: ["docker"] };
const JK_DEPLOY: CiRunner = { name: "agent-deploy-1", hosted: false, labels: ["deploy"] };

const BUILD_STEPS = ["Set up job", "Checkout", "Install", "Build", "Upload artifact"];
const TEST_STEPS = ["Set up job", "Checkout", "Install", "Run tests", "Report"];

const SCENARIOS: RunSpec[][] = [
  [
    {
      provider: "githubActions",
      pipeline: "CI",
      number: 4812,
      trigger: "push",
      cycle: 150,
      phase: 0,
      jobs: [
        { name: "lint", start: 0, duration: 25, runner: GH_UBUNTU, steps: TEST_STEPS },
        { name: "typecheck", start: 0, duration: 40, runner: GH_UBUNTU, steps: TEST_STEPS },
        { name: "test · daemon", start: 5, duration: 90, runner: GH_UBUNTU, steps: TEST_STEPS },
        { name: "build · windows", start: 10, duration: 110, runner: WIN_SELF, steps: BUILD_STEPS },
        {
          name: "build · android",
          start: 45,
          duration: 80,
          runner: ANDROID_SELF,
          steps: BUILD_STEPS,
        },
      ],
    },
  ],
  [
    {
      provider: "jenkins",
      pipeline: "frogg-daemon",
      number: 221,
      trigger: "SCM change",
      cycle: 120,
      phase: 40,
      jobs: [
        {
          name: "Checkout",
          start: 0,
          duration: 10,
          runner: JK_LINUX,
          steps: ["Clone", "Submodules"],
        },
        { name: "Build", start: 10, duration: 40, runner: JK_LINUX, steps: ["cargo build"] },
        {
          name: "Integration",
          start: 50,
          duration: 45,
          runner: JK_LINUX,
          steps: ["Start fixtures", "cargo test --features it", "Collect logs"],
          fails: true,
        },
      ],
    },
  ],
  [
    {
      provider: "githubActions",
      pipeline: "Release",
      number: 93,
      trigger: "tag v1.5.8",
      cycle: 200,
      phase: 90,
      jobs: [
        { name: "desktop · macOS", start: 0, duration: 120, runner: GH_MAC, steps: BUILD_STEPS },
        { name: "desktop · linux", start: 0, duration: 80, runner: GH_UBUNTU, steps: BUILD_STEPS },
        {
          name: "desktop · windows",
          start: 0,
          duration: 140,
          runner: WIN_SELF,
          steps: BUILD_STEPS,
        },
        {
          name: "publish",
          start: 140,
          duration: 30,
          runner: GH_UBUNTU,
          steps: ["Sign", "Upload", "Update feed"],
        },
      ],
    },
    {
      provider: "jenkins",
      pipeline: "deploy-relay",
      number: 58,
      trigger: "upstream Release #93",
      cycle: 200,
      phase: 0,
      jobs: [
        {
          name: "Deploy staging",
          start: 170,
          duration: 15,
          runner: JK_DEPLOY,
          steps: ["helm upgrade"],
        },
        {
          name: "Smoke",
          start: 185,
          duration: 12,
          runner: JK_DEPLOY,
          steps: ["Health", "Pair round-trip"],
        },
      ],
    },
  ],
  [],
];

/**
 * Scenarios are handed out in the order workspaces first ask, so the sidebar's top rows always
 * show one of each state rather than whatever a hash happens to pick.
 */
const scenarioByWorkspace = new Map<string, number>();

function scenarioFor(workspaceId: string): RunSpec[] {
  let index = scenarioByWorkspace.get(workspaceId);
  if (index === undefined) {
    index = scenarioByWorkspace.size % SCENARIOS.length;
    scenarioByWorkspace.set(workspaceId, index);
  }
  return SCENARIOS[index] ?? [];
}

function resolveJob(spec: JobSpec, t: number, runId: string, index: number): CiJob {
  const into = t - spec.start;
  const progress = Math.max(0, Math.min(1, into / spec.duration));
  let status: CiStatus;
  if (into < 0) status = "queued";
  else if (progress < 1) status = "running";
  else status = spec.fails ? "failure" : "success";
  const doneSteps = Math.floor(progress * spec.steps.length);
  const steps = spec.steps.map<CiStep>((name, i) => {
    if (i < doneSteps) return { name, status: "success" };
    if (i === doneSteps && status === "running") return { name, status: "running" };
    if (status === "failure" && i === spec.steps.length - 1) return { name, status: "failure" };
    return { name, status: status === "success" ? "success" : "queued" };
  });
  if (status === "failure") {
    const last = steps.length > 1 ? steps.length - 2 : 0;
    steps[last] = { name: spec.steps[last] ?? "", status: "failure" };
  }
  return {
    id: `${runId}:${index}`,
    name: spec.name,
    status,
    progress: status === "queued" ? 0 : progress,
    elapsedMs: Math.max(0, Math.min(into, spec.duration)) * 1000,
    runner: status === "queued" ? null : spec.runner,
    steps,
  };
}

function rollUp(jobs: CiJob[]): CiStatus {
  if (jobs.some((job) => job.status === "failure")) return "failure";
  if (jobs.some((job) => job.status === "running")) return "running";
  if (jobs.every((job) => job.status === "success")) return "success";
  return jobs.some((job) => job.status === "success") ? "running" : "queued";
}

export function resolveMockCiRuns(workspaceId: string, nowMs: number): CiRun[] {
  const specs = scenarioFor(workspaceId);
  return specs.map((spec) => {
    const runId = `${spec.provider}:${spec.pipeline}:${spec.number}`;
    // Hold the finished state for the last stretch of each cycle, as a real run would sit
    // finished until the next push.
    const t = (nowMs / 1000 + spec.phase) % spec.cycle;
    const jobs = spec.jobs.map((job, index) => resolveJob(job, t, runId, index));
    const total = jobs.reduce((sum, job) => sum + job.progress, 0);
    const status = rollUp(jobs);
    return {
      id: runId,
      provider: spec.provider,
      pipeline: spec.pipeline,
      number: spec.number,
      trigger: spec.trigger,
      status,
      progress: status === "failure" ? 1 : total / jobs.length,
      elapsedMs: Math.max(0, Math.min(t, spec.cycle)) * 1000,
      jobs,
    };
  });
}

/** One clock per second, shared by every row and the pane so they tick together. */
const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: (now: number) => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => {
    const now = Date.now();
    for (const fn of listeners) fn(now);
  }, 1000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

export function useMockCiRuns(workspaceId: string | null | undefined): CiRun[] {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => subscribe(setNow), []);
  return workspaceId ? resolveMockCiRuns(workspaceId, now) : [];
}

export function formatCiDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
