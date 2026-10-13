// Mock CI for the lab and the preview shell: realistic Frogg runs across every state, and a
// simulator that advances running jobs step by step so the panel can be watched live.
import { setCiRuns, useCi, type CiJob, type CiRun } from "../../components/ci/model";
import { useLab } from "../store";

const BRANCH = "feat/session-cache-cap";
const REPO = "https://github.com/frogg-app/frogg";

const iso = (secAgo: number) => new Date(Date.now() - secAgo * 1000).toISOString();

/** Simulation facts per job that the wire shape has no room for. */
interface Plan {
  /** Seconds of work at speed 1. */
  len: number;
  /** Job ids that must pass first. */
  needs: string[];
  /** Fail at this 0-based step, with this log. */
  failAt?: { step: number; log: string[] };
  /** Fails on attempt 1 only (flaky). */
  flaky?: boolean;
}
const plans = new Map<string, Plan>();

const STEPS: Record<string, string[]> = {
  lint: ["Set up job", "Checkout", "Setup Node 22", "npm ci", "Run oxlint", "Run oxfmt --check"],
  typecheck: [
    "Set up job",
    "Checkout",
    "Setup Node 22",
    "npm ci",
    "Build packages",
    "tsgo --noEmit",
  ],
  unit: [
    "Set up job",
    "Checkout",
    "Setup Node 22",
    "npm ci",
    "Build packages",
    "vitest run (protocol)",
    "vitest run (server)",
    "vitest run (ui)",
    "Upload coverage",
  ],
  e2e: ["Set up job", "Checkout", "npm ci", "Install Playwright", "Start daemon", "Playwright e2e"],
  "build-daemon": [
    "Set up job",
    "Checkout",
    "npm ci",
    "Build daemon",
    "Bundle node runtime",
    "Upload artifact",
  ],
  "build-android": [
    "Set up job",
    "Checkout",
    "Setup JDK 17",
    "npm ci",
    "expo prebuild",
    "Gradle assembleRelease",
    "Sign APK",
    "Upload artifact",
  ],
  desktop: [
    "Set up job",
    "Checkout",
    "npm ci",
    "Build renderer",
    "electron-builder",
    "Sign + notarise",
    "Upload artifact",
  ],
  release: ["Set up job", "Download artifacts", "Generate update feed", "Publish release"],
};

const VITEST_FAIL = [
  " FAIL  packages/server/src/session-cache.test.ts > evicts least recently used",
  "AssertionError: expected [ 's-2', 's-3' ] to deeply equal [ 's-1', 's-3' ]",
  " ❯ packages/server/src/session-cache.test.ts:48:31",
  "",
  " Test Files  1 failed | 63 passed (64)",
  "      Tests  1 failed | 911 passed (912)",
  "Error: Process completed with exit code 1.",
];
const WIN_FAIL = [
  " FAIL  packages/ui/test/locale.test.ts > ja > settings.notifications.title",
  'AssertionError: expected "通知" to have length ≤ 12 (got 14 with padding)',
  " FAIL  packages/ui/test/locale.test.ts > ar > rtl mirrors chevrons",
  "Error: snapshot mismatch (1 line)",
  " Test Files  1 failed | 37 passed (38)",
  "Error: Process completed with exit code 1.",
];
const E2E_FLAKE = [
  " ✘  chat.spec.ts:88 › reconnect keeps the composer draft (31.2s)",
  "Error: Timed out 30000ms waiting for expect(locator).toHaveText()",
  "Retry #1 scheduled on attempt 2",
];
const ANDROID_FAIL = [
  "> Task :app:mergeReleaseResources FAILED",
  "error: resource drawable/ic_launcher_foreground not found.",
  "FAILURE: Build failed with an exception.",
  "Error: Process completed with exit code 1.",
];

type Status = "queued" | "in_progress" | "success" | "failure" | "cancelled" | "skipped";

interface JobSpec {
  key: string;
  name: string;
  steps: keyof typeof STEPS;
  status: Status;
  /** Running: 0..1. */
  progress?: number;
  len: number;
  needs?: string[];
  /** Done: how long ago it started, and took. */
  ago?: number;
  took?: number;
  runner?: string;
  failAt?: Plan["failAt"];
  flaky?: boolean;
  attempt?: number;
}

function stepStatuses(names: string[], status: Status, progress: number, failStep?: number) {
  const at = Math.min(names.length - 1, Math.floor(progress * names.length));
  return names.map((name, n) => {
    let st: Status = "queued";
    if (status === "success") st = "success";
    else if (status === "skipped") st = "skipped";
    else if (status === "failure") {
      const f = failStep ?? names.length - 1;
      if (n < f) st = "success";
      else if (n === f) st = "failure";
      else st = "skipped";
    } else if (status === "cancelled") {
      if (n < at) st = "success";
      else if (n === at && progress > 0) st = "cancelled";
      else st = "skipped";
    } else if (status === "in_progress") {
      if (n < at) st = "success";
      else if (n === at) st = "in_progress";
    }
    return { name, status: st };
  });
}

function job(runId: string, run: { url: string }, sp: JobSpec): CiJob {
  const id = `${runId}-${sp.key}`;
  plans.set(id, {
    len: sp.len,
    needs: (sp.needs ?? []).map((k) => `${runId}-${k}`),
    failAt: sp.failAt,
    flaky: sp.flaky,
  });
  const names = STEPS[sp.steps] ?? [];
  const progress = sp.progress ?? 0;
  const running = sp.status === "in_progress";
  const done = !running && sp.status !== "queued";
  let started: string | null = null;
  if (running) started = iso(progress * sp.len);
  else if (done && sp.ago) started = iso(sp.ago);
  const completed = done && sp.ago ? iso(sp.ago - (sp.took ?? sp.len)) : null;
  return {
    id,
    name: sp.name,
    status: sp.status,
    progress: running ? progress : null,
    startedAt: sp.status === "skipped" ? null : started,
    completedAt: sp.status === "skipped" ? null : completed,
    url: `${run.url}/job/${id}`,
    runner: sp.runner
      ? { name: sp.runner, hosted: false, labels: ["self-hosted"] }
      : { name: "ubuntu-latest", hosted: true, labels: [] },
    steps: stepStatuses(names, sp.status, progress, sp.failAt?.step),
    log: sp.status === "failure" ? sp.failAt?.log : undefined,
    attempt: sp.attempt,
  };
}

interface RunSpec {
  id: string;
  number: number;
  pipeline: string;
  branch: string;
  trigger: string;
  title: string;
  actor: string;
  sha: string;
  status: Status;
  ago?: number;
  took?: number;
  attempt?: number;
  jobs: JobSpec[];
}

function mkRun(sp: RunSpec): CiRun {
  const url = `${REPO}/actions/runs/${sp.id.replace(/\D/g, "")}`;
  const jobs = sp.jobs.map((j) => job(sp.id, { url }, j));
  const started = jobs
    .map((j) => j.startedAt)
    .filter((s): s is string => !!s)
    .sort()[0];
  const done = sp.status !== "in_progress" && sp.status !== "queued";
  return {
    id: sp.id,
    provider: "githubActions",
    pipeline: sp.pipeline,
    branch: sp.branch,
    number: sp.number,
    trigger: sp.trigger,
    status: sp.status,
    progress: null,
    startedAt: sp.ago ? iso(sp.ago) : (started ?? null),
    completedAt: done && sp.ago ? iso(sp.ago - (sp.took ?? 0)) : null,
    url,
    jobs,
    title: sp.title,
    actor: sp.actor,
    sha: sp.sha,
    attempt: sp.attempt,
  };
}

const CHECKS = (status: Status, prog: number[]): JobSpec[] => [
  { key: "lint", name: "lint", steps: "lint", status: "success", len: 20, ago: 70, took: 17 },
  {
    key: "tc",
    name: "typecheck",
    steps: "typecheck",
    status: "success",
    len: 45,
    ago: 70,
    took: 41,
  },
  { key: "unit", name: "unit", steps: "unit", status, progress: prog[0], len: 190, needs: ["tc"] },
  {
    key: "and",
    name: "build-android",
    steps: "build-android",
    status: "queued",
    len: 260,
    needs: ["tc"],
    runner: "android-builder-1",
  },
  {
    key: "win",
    name: "build-desktop-windows",
    steps: "desktop",
    status,
    progress: prog[1],
    len: 300,
    needs: ["lint"],
  },
];

/** Every state the panel draws, newest first. */
export function ciFixtures(): CiRun[] {
  plans.clear();
  return [
    mkRun({
      id: "r8820",
      number: 8820,
      pipeline: "CI",
      branch: "fix/relay-backoff",
      trigger: "push",
      title: "Back off relay reconnects exponentially",
      actor: "Codex",
      sha: "9b2e41c7",
      status: "queued",
      jobs: [
        { key: "lint", name: "lint", steps: "lint", status: "queued", len: 18 },
        { key: "tc", name: "typecheck", steps: "typecheck", status: "queued", len: 40 },
        { key: "unit", name: "unit", steps: "unit", status: "queued", len: 150, needs: ["tc"] },
      ],
    }),
    mkRun({
      id: "r8818",
      number: 8818,
      pipeline: "CI",
      branch: BRANCH,
      trigger: "pull_request",
      title: "Cap the session cache and evict LRU",
      actor: "Claude Code",
      sha: "a41f9c2e",
      status: "in_progress",
      jobs: CHECKS("in_progress", [0.63, 0.35]),
    }),
    mkRun({
      id: "r8815",
      number: 8815,
      pipeline: "Release · beta",
      branch: "main",
      trigger: "push",
      title: "Release 1.6.0-beta.4",
      actor: "paz",
      sha: "c0ffee12",
      status: "in_progress",
      jobs: [
        {
          key: "daemon",
          name: "build-daemon",
          steps: "build-daemon",
          status: "success",
          len: 140,
          ago: 760,
          took: 132,
        },
        {
          key: "linux",
          name: "build-desktop-linux",
          steps: "desktop",
          status: "success",
          len: 400,
          ago: 760,
          took: 386,
        },
        {
          key: "mac",
          name: "build-desktop-mac",
          steps: "desktop",
          status: "in_progress",
          progress: 0.78,
          len: 960,
          runner: "mac-mini-2",
        },
        {
          key: "win",
          name: "build-desktop-windows",
          steps: "desktop",
          status: "in_progress",
          progress: 0.41,
          len: 1500,
        },
        {
          key: "and",
          name: "build-android",
          steps: "build-android",
          status: "success",
          len: 600,
          ago: 760,
          took: 571,
          runner: "android-builder-1",
        },
        {
          key: "rel",
          name: "release",
          steps: "release",
          status: "queued",
          len: 60,
          needs: ["mac", "win"],
        },
      ],
    }),
    mkRun({
      id: "r8812",
      number: 8812,
      pipeline: "CI",
      branch: BRANCH,
      trigger: "pull_request",
      title: "Thread sessionCache.maxEntries through the store",
      actor: "Claude Code",
      sha: "7d3006e6",
      status: "failure",
      ago: 1500,
      took: 252,
      jobs: [
        {
          key: "lint",
          name: "lint",
          steps: "lint",
          status: "success",
          len: 20,
          ago: 1500,
          took: 18,
        },
        {
          key: "tc",
          name: "typecheck",
          steps: "typecheck",
          status: "success",
          len: 45,
          ago: 1500,
          took: 43,
        },
        {
          key: "unit",
          name: "unit",
          steps: "unit",
          status: "failure",
          len: 190,
          ago: 1455,
          took: 207,
          needs: ["tc"],
          failAt: { step: 6, log: VITEST_FAIL },
        },
        { key: "e2e", name: "e2e", steps: "e2e", status: "skipped", len: 240, needs: ["unit"] },
      ],
    }),
    mkRun({
      id: "r8809",
      number: 8809,
      pipeline: "CI",
      branch: "fix/draft-loss",
      trigger: "pull_request",
      title: "Keep the composer draft across reconnects",
      actor: "ana-k",
      sha: "b4d028f8",
      status: "success",
      attempt: 2,
      ago: 2600,
      took: 486,
      jobs: [
        {
          key: "lint",
          name: "lint",
          steps: "lint",
          status: "success",
          len: 20,
          ago: 2600,
          took: 17,
        },
        {
          key: "tc",
          name: "typecheck",
          steps: "typecheck",
          status: "success",
          len: 45,
          ago: 2600,
          took: 44,
        },
        {
          key: "unit",
          name: "unit",
          steps: "unit",
          status: "success",
          len: 190,
          ago: 2550,
          took: 188,
        },
        {
          key: "e2e",
          name: "e2e",
          steps: "e2e",
          status: "success",
          len: 240,
          ago: 2350,
          took: 236,
          attempt: 2,
        },
      ],
    }),
    mkRun({
      id: "r8801",
      number: 8801,
      pipeline: "Desktop matrix",
      branch: "chore/i18n-settings",
      trigger: "pull_request",
      title: "Translate settings strings (9 locales)",
      actor: "Copilot",
      sha: "90ea08d9",
      status: "failure",
      ago: 3200,
      took: 251,
      jobs: [
        {
          key: "linux",
          name: "unit (linux)",
          steps: "unit",
          status: "success",
          len: 180,
          ago: 3200,
          took: 182,
        },
        {
          key: "mac",
          name: "unit (mac)",
          steps: "unit",
          status: "success",
          len: 200,
          ago: 3200,
          took: 214,
        },
        {
          key: "win",
          name: "unit (windows)",
          steps: "unit",
          status: "failure",
          len: 250,
          ago: 3200,
          took: 251,
          failAt: { step: 7, log: WIN_FAIL },
        },
      ],
    }),
    mkRun({
      id: "r8797",
      number: 8797,
      pipeline: "Android",
      branch: "fix/adaptive-icon",
      trigger: "push",
      title: "Android: adaptive icon",
      actor: "paz",
      sha: "d8830737",
      status: "cancelled",
      ago: 5400,
      took: 96,
      jobs: [
        {
          key: "tc",
          name: "typecheck",
          steps: "typecheck",
          status: "success",
          len: 45,
          ago: 5400,
          took: 42,
        },
        {
          key: "and",
          name: "build-android",
          steps: "build-android",
          status: "cancelled",
          progress: 0.4,
          len: 600,
          ago: 5355,
          took: 51,
        },
      ],
    }),
    mkRun({
      id: "r8790",
      number: 8790,
      pipeline: "CI",
      branch: "main",
      trigger: "push",
      title: "Gallery: keyboard anchoring section",
      actor: "paz",
      sha: "c60867bd",
      status: "success",
      ago: 9000,
      took: 312,
      jobs: [
        {
          key: "lint",
          name: "lint",
          steps: "lint",
          status: "success",
          len: 20,
          ago: 9000,
          took: 16,
        },
        {
          key: "tc",
          name: "typecheck",
          steps: "typecheck",
          status: "success",
          len: 45,
          ago: 9000,
          took: 40,
        },
        {
          key: "unit",
          name: "unit",
          steps: "unit",
          status: "success",
          len: 190,
          ago: 8955,
          took: 194,
        },
        { key: "e2e", name: "e2e", steps: "e2e", status: "success", len: 240, ago: 8760, took: 72 },
      ],
    }),
  ];
}

// ─── simulator ──────────────────────────────────────────────────────────────────────────────

/** Simulated seconds per tick; ticks fire every TICK_MS / lab speed. */
const TICK_MS = 700;
const SIM_SEC = 9;

const doneSt = (s: string) => s !== "queued" && s !== "in_progress";

function rollUp(r: CiRun, now: string): CiRun {
  const sts = r.jobs.map((j) => j.status);
  let status: string = r.status;
  if (r.status === "cancelled") return r;
  if (sts.some((s) => s === "in_progress")) status = "in_progress";
  else if (sts.every(doneSt)) status = sts.some((s) => s === "failure") ? "failure" : "success";
  else if (sts.every((s) => s === "queued" || s === "skipped"))
    status = r.startedAt ? "in_progress" : "queued";
  else status = "in_progress";
  const finished = doneSt(status);
  return {
    ...r,
    status,
    startedAt: r.startedAt ?? (status === "in_progress" ? now : null),
    completedAt: finished ? (r.completedAt ?? now) : null,
  };
}

function failJob(
  jb: CiJob,
  plan: Plan | undefined,
  at: number,
  now: string,
  log?: string[],
): CiJob {
  const names = jb.steps.map((st) => st.name);
  return {
    ...jb,
    status: "failure",
    progress: null,
    completedAt: now,
    steps: stepStatuses(names, "failure", 0, at) as CiJob["steps"],
    log: log ?? plan?.failAt?.log ?? VITEST_FAIL,
  };
}

/** Advances one job by `sec` simulated seconds. */
function stepJob(jb: CiJob, byId: Map<string, CiJob>, sec: number, now: string): CiJob {
  const plan = plans.get(jb.id);
  if (jb.status === "queued") {
    const ready = (plan?.needs ?? []).every((n) => byId.get(n)?.status === "success");
    const blocked = (plan?.needs ?? []).some((n) => {
      const st = byId.get(n)?.status;
      return st && doneSt(st) && st !== "success";
    });
    if (blocked)
      return {
        ...jb,
        status: "skipped",
        steps: jb.steps.map((st) => ({ ...st, status: "skipped" })),
      };
    if (!ready) return jb;
    const names = jb.steps.map((st) => st.name);
    return {
      ...jb,
      status: "in_progress",
      progress: 0,
      startedAt: now,
      steps: stepStatuses(names, "in_progress", 0),
    };
  }
  if (jb.status !== "in_progress") return jb;
  const len = plan?.len ?? 60;
  const progress = Math.min(1, (jb.progress ?? 0) + (sec / len) * (0.7 + Math.random() * 0.6));
  const names = jb.steps.map((st) => st.name);
  const fail = plan?.failAt;
  const failsNow =
    fail && (!plan?.flaky || (jb.attempt ?? 1) < 2) && progress >= (fail.step + 0.5) / names.length;
  if (failsNow) return failJob(jb, plan, fail.step, now);
  if (progress >= 1)
    return {
      ...jb,
      status: "success",
      progress: null,
      completedAt: now,
      steps: stepStatuses(names, "success", 1),
    };
  return { ...jb, progress, steps: stepStatuses(names, "in_progress", progress) };
}

/** One simulation step across every unfinished run. */
let lastTick = 0;
/** Moves a start stamp back so wall-clock elapsed reads as simulated time. */
const back = (at: string | null, ms: number) =>
  at ? new Date(Date.parse(at) - ms).toISOString() : at;

export function advanceCi(sec = SIM_SEC): void {
  const t = Date.now();
  const real = lastTick ? Math.min(t - lastTick, sec * 1000) : 0;
  lastTick = t;
  // Simulated time runs faster than the wall clock; open timers are backdated by the difference
  // so durations and ETAs agree with the progress they sit beside.
  const shift = Math.max(0, sec * 1000 - real);
  const now = new Date(t).toISOString();
  // oxlint-disable-next-line no-map-spread -- the store needs new objects for changed runs
  const runs = useCi.getState().runs.map((r) => {
    if (doneSt(r.status)) return r;
    const byId = new Map(r.jobs.map((jb) => [jb.id, jb]));
    const jobs = r.jobs.map((jb) => {
      const next = stepJob(jb, byId, sec, now);
      return jb.status === "in_progress"
        ? { ...next, startedAt: back(next.startedAt, shift) }
        : next;
    });
    const rolled = rollUp({ ...r, jobs }, now);
    return r.startedAt && !doneSt(rolled.status)
      ? { ...rolled, startedAt: back(rolled.startedAt, shift) }
      : rolled;
  });
  setCiRuns(runs);
}

const edit = (id: string, fn: (r: CiRun, now: string) => CiRun) => {
  const now = new Date().toISOString();
  setCiRuns(useCi.getState().runs.map((r) => (r.id === id ? fn(r, now) : r)));
};
const firstRunning = () => useCi.getState().runs.find((r) => r.status === "in_progress");

/** Fails the furthest-along running job at its current step with a vitest-style log. */
export function failRunningJob(): void {
  const r = firstRunning();
  if (!r) return;
  const target = [...r.jobs]
    .filter((jb) => jb.status === "in_progress")
    .sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))[0];
  if (!target) return;
  edit(r.id, (run, now) => {
    const jobs = run.jobs.map((jb) => {
      if (jb.id !== target.id) return jb;
      const at = jb.steps.findIndex((st) => st.status === "in_progress");
      const log = jb.name.includes("android") ? ANDROID_FAIL : VITEST_FAIL;
      return failJob(jb, plans.get(jb.id), Math.max(0, at), now, log);
    });
    return rollUp({ ...run, jobs }, now);
  });
}

/** Cancels a run: running jobs stop, queued ones are skipped. */
export function cancelCi(id: string): void {
  edit(id, (run, now) => ({
    ...run,
    status: "cancelled",
    completedAt: now,
    jobs: run.jobs.map((jb) => {
      if (jb.status === "in_progress") {
        const names = jb.steps.map((st) => st.name);
        return {
          ...jb,
          status: "cancelled",
          completedAt: now,
          steps: stepStatuses(names, "cancelled", jb.progress ?? 0),
          progress: null,
        };
      }
      if (jb.status === "queued")
        return {
          ...jb,
          status: "skipped",
          steps: jb.steps.map((st) => ({ ...st, status: "skipped" })),
        };
      return jb;
    }),
  }));
}

/** Re-runs a finished run as its next attempt: failed (or all) jobs go back to the queue. */
export function rerunCi(id: string, failedOnly: boolean): void {
  edit(id, (run) => {
    const again = (jb: CiJob) =>
      !failedOnly ||
      jb.status === "failure" ||
      jb.status === "cancelled" ||
      jb.status === "skipped";
    const attempt = (run.attempt ?? 1) + 1;
    return {
      ...run,
      status: "queued",
      attempt,
      startedAt: null,
      completedAt: null,
      jobs: run.jobs.map((jb) => {
        if (!again(jb)) return jb;
        const plan = plans.get(jb.id);
        // A rerun of a failure passes, like the flaky retries it stands in for.
        if (plan) plans.set(jb.id, { ...plan, failAt: undefined });
        return {
          ...jb,
          status: "queued",
          progress: null,
          startedAt: null,
          completedAt: null,
          attempt,
          log: undefined,
          steps: jb.steps.map((st) => ({ ...st, status: "queued" })),
        };
      }),
    };
  });
}

let runSeq = 8821;
/** Pushes a fresh run for the preview branch at the top of the list. */
export function startCiRun(): void {
  runSeq += 1;
  const id = `r${runSeq}`;
  const fresh = mkRun({
    id,
    number: runSeq,
    pipeline: "CI",
    branch: BRANCH,
    trigger: "push",
    title: "Log cache evictions at debug",
    actor: "Claude Code",
    sha: `${runSeq.toString(16)}e1a0b`,
    status: "queued",
    jobs: [
      { key: "lint", name: "lint", steps: "lint", status: "queued", len: 20 },
      { key: "tc", name: "typecheck", steps: "typecheck", status: "queued", len: 45 },
      { key: "unit", name: "unit", steps: "unit", status: "queued", len: 120, needs: ["tc"] },
      {
        key: "e2e",
        name: "e2e",
        steps: "e2e",
        status: "queued",
        len: 150,
        needs: ["unit"],
        failAt: { step: 5, log: E2E_FLAKE },
        flaky: true,
      },
      {
        key: "daemon",
        name: "build-daemon",
        steps: "build-daemon",
        status: "queued",
        len: 90,
        needs: ["lint"],
      },
    ],
  });
  setCiRuns([fresh, ...useCi.getState().runs]);
}

let timer: ReturnType<typeof setInterval> | null = null;
let rate = 1;
export const ciAuto = { on: false };
const listeners = new Set<() => void>();
export const onCiAuto = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Ticks the simulation on a timer scaled by the lab speed. */
export function setCiAuto(on: boolean): void {
  if (timer) clearInterval(timer);
  timer = null;
  ciAuto.on = on;
  rate = Number(useLab.getState().speed) || 1;
  if (on) timer = setInterval(() => advanceCi(), TICK_MS / rate);
  for (const fn of listeners) fn();
}

/** Fresh fixtures with the lab's rerun/cancel handlers; `auto` starts the clock. */
export function seedCi(auto = true): void {
  setCiRuns(ciFixtures());
  useCi.setState({ open: null, list: null, actions: { rerun: rerunCi, cancel: cancelCi } });
  setCiAuto(auto);
}

/** The fixture host's answer to checkout.ci.list_runs. */
export function ciListRuns(cwd: string) {
  return {
    cwd,
    branch: BRANCH,
    runs: useCi.getState().runs,
    providers: ["githubActions"],
    providerErrors: [],
    error: null,
    requestId: "lab",
  };
}

/** The fixture host's PR for the preview branch; its checks follow the latest run there. */
export function ciPrStatus(cwd: string) {
  const latest = useCi.getState().runs.find((r) => r.branch === BRANCH);
  return {
    cwd,
    githubFeaturesEnabled: true,
    authState: "authenticated",
    forge: "github",
    error: null,
    requestId: "lab",
    status: {
      forge: "github",
      number: 1284,
      url: `${REPO}/pull/1284`,
      title: "Cap the session cache and evict least recently used",
      state: "open",
      baseRefName: "main",
      headRefName: BRANCH,
      isMerged: false,
      isDraft: false,
      mergeable: "MERGEABLE",
      reviewDecision: "REVIEW_REQUIRED",
      checks: (latest?.jobs ?? []).map((jb) => ({
        name: jb.name,
        status: jb.status,
        url: jb.url,
        workflow: latest?.pipeline,
      })),
    },
  };
}
