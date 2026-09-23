// Progress of the CI job that builds this platform's installer.
//
// A release tag publishes its assets per platform as each runner finishes, so
// the updater can see `vX.Y.Z` with no download for *this* platform yet. Rather
// than a bare "not published", Settings shows how far the matching Release
// workflow job has got. The data comes from the public GitHub Actions API, so
// it is unauthenticated and rate limited (60 requests/hour/IP): results are
// cached here and refreshed on a slow interval, and a rate-limit response backs
// off until the window resets instead of retrying.

import { brand } from "@frogg/branding";

export type ReleaseBuildState = "queued" | "running" | "succeeded" | "failed";

export interface ReleaseBuildStatus {
  /** Version whose release run this describes, without the `v`. */
  version: string;
  state: ReleaseBuildState;
  /** Workflow job name, e.g. `desktop macos aarch64`. */
  jobName: string;
  /** Steps finished and steps in the job; the bar is completed/total. */
  completedSteps: number;
  totalSteps: number;
  /** Name of the step currently running, when one is. */
  currentStep: string | null;
  startedAt: number | null;
  url: string | null;
}

interface GithubJobStep {
  name: string;
  status: string;
  conclusion: string | null;
}

interface GithubJob {
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  html_url: string | null;
  steps: GithubJobStep[];
}

const GITHUB_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;
/** Two API calls per miss and 60/hour unauthenticated; this stays well inside. */
export const RELEASE_BUILD_STATUS_REFRESH_MS = 90_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * The Release workflow's desktop matrix job name for a runtime, or `null` when
 * this runtime has no desktop build of its own. Windows on arm64 runs the x64
 * build, so it follows that job.
 */
export function resolveDesktopJobName(platform: string, arch: string): string | null {
  switch (platform) {
    case "win32":
      return "desktop windows x86_64";
    case "linux":
      return arch === "x64" ? "desktop linux x86_64" : null;
    case "darwin":
      return arch === "arm64" ? "desktop macos aarch64" : "desktop macos x86_64";
    default:
      return null;
  }
}

function parseSteps(value: unknown): GithubJobStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const name = toStringOrNull(entry.name);
    if (!name) return [];
    return [
      {
        name,
        status: typeof entry.status === "string" ? entry.status : "queued",
        conclusion: toStringOrNull(entry.conclusion),
      },
    ];
  });
}

export function parseGithubJobs(payload: unknown): GithubJob[] {
  if (!isRecord(payload) || !Array.isArray(payload.jobs)) return [];
  return payload.jobs.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const name = toStringOrNull(entry.name);
    if (!name) return [];
    return [
      {
        name,
        status: typeof entry.status === "string" ? entry.status : "queued",
        conclusion: toStringOrNull(entry.conclusion),
        started_at: toStringOrNull(entry.started_at),
        html_url: toStringOrNull(entry.html_url),
        steps: parseSteps(entry.steps),
      },
    ];
  });
}

/** Id of the newest workflow run for `tag`, or `null` when none has started. */
export function selectRunIdForTag(payload: unknown, tag: string): number | null {
  if (!isRecord(payload) || !Array.isArray(payload.workflow_runs)) return null;
  const runs = payload.workflow_runs.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (entry.head_branch !== tag) return [];
    const id = typeof entry.id === "number" && Number.isFinite(entry.id) ? entry.id : null;
    if (id === null) return [];
    const startedAt = Date.parse(toStringOrNull(entry.run_started_at) ?? "");
    return [{ id, startedAt: Number.isNaN(startedAt) ? 0 : startedAt }];
  });
  runs.sort((a, b) => b.startedAt - a.startedAt || b.id - a.id);
  return runs[0]?.id ?? null;
}

function resolveState(job: GithubJob): ReleaseBuildState {
  if (job.status === "completed") return job.conclusion === "success" ? "succeeded" : "failed";
  return job.status === "in_progress" ? "running" : "queued";
}

export function summarizeJob(job: GithubJob, version: string): ReleaseBuildStatus {
  const finished = job.steps.filter(
    (step) => step.status === "completed" && step.conclusion !== "skipped",
  ).length;
  const running = job.steps.find((step) => step.status === "in_progress") ?? null;
  const startedAt = job.started_at === null ? null : Date.parse(job.started_at);
  const state = resolveState(job);

  return {
    version,
    state,
    jobName: job.name,
    // A completed job shows a full bar even when trailing steps were skipped.
    completedSteps: state === "succeeded" ? job.steps.length : finished,
    totalSteps: job.steps.length,
    currentStep: running?.name ?? null,
    startedAt: startedAt === null || Number.isNaN(startedAt) ? null : startedAt,
    url: job.html_url,
  };
}

export interface ReleaseBuildStatusServiceDeps {
  repository?: string | null;
  platform?: string;
  arch?: string;
  now?: () => number;
  fetchJson?: (url: string) => Promise<{ payload: unknown; retryAfterMs: number | null }>;
}

export interface ReleaseBuildStatusService {
  /** Cached between refreshes; `null` when there is nothing to show. */
  get(version: string): Promise<ReleaseBuildStatus | null>;
}

async function fetchGithubJson(
  url: string,
): Promise<{ payload: unknown; retryAfterMs: number | null }> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 403 || response.status === 429) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const retryAfter = Number(response.headers.get("retry-after"));
    const untilReset = Number.isFinite(reset) && reset > 0 ? reset * 1000 - Date.now() : null;
    const untilRetry = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null;
    return { payload: null, retryAfterMs: Math.max(untilReset ?? untilRetry ?? 60_000, 60_000) };
  }
  if (!response.ok) throw new Error(`GitHub API request failed (${response.status}).`);
  return { payload: await response.json(), retryAfterMs: null };
}

export function createReleaseBuildStatusService(
  deps: ReleaseBuildStatusServiceDeps = {},
): ReleaseBuildStatusService {
  const repository =
    deps.repository === undefined ? brand.distribution.repository : deps.repository;
  const jobName = resolveDesktopJobName(
    deps.platform ?? process.platform,
    deps.arch ?? process.arch,
  );
  const now = deps.now ?? Date.now;
  const fetchJson = deps.fetchJson ?? fetchGithubJson;

  let cachedVersion: string | null = null;
  let cached: ReleaseBuildStatus | null = null;
  let nextRefreshAt = 0;
  let runIds = new Map<string, number>();
  let inFlight: Promise<ReleaseBuildStatus | null> | null = null;

  async function resolveRunId(tag: string): Promise<number | null> {
    const known = runIds.get(tag);
    if (known !== undefined) return known;
    const { payload, retryAfterMs } = await fetchJson(
      `${GITHUB_API}/repos/${repository}/actions/runs?per_page=30`,
    );
    if (retryAfterMs !== null) {
      nextRefreshAt = now() + retryAfterMs;
      return null;
    }
    const id = selectRunIdForTag(payload, tag);
    // Only a found run is worth remembering; a tag with no run yet must re-ask.
    if (id !== null) {
      if (runIds.size > 8) runIds = new Map();
      runIds.set(tag, id);
    }
    return id;
  }

  async function refresh(version: string): Promise<ReleaseBuildStatus | null> {
    const runId = await resolveRunId(`v${version}`);
    if (runId === null) return null;
    const { payload, retryAfterMs } = await fetchJson(
      `${GITHUB_API}/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`,
    );
    if (retryAfterMs !== null) {
      nextRefreshAt = now() + retryAfterMs;
      return cachedVersion === version ? cached : null;
    }
    const job = parseGithubJobs(payload).find((candidate) => candidate.name === jobName);
    return job ? summarizeJob(job, version) : null;
  }

  return {
    async get(version) {
      if (!repository || !jobName || !version.trim()) return null;
      if (cachedVersion === version && now() < nextRefreshAt) return cached;
      if (inFlight) return await inFlight;
      inFlight = refresh(version)
        .catch(() => (cachedVersion === version ? cached : null))
        .then((status) => {
          cachedVersion = version;
          cached = status;
          // A rate-limit response has already pushed the refresh out further.
          nextRefreshAt = Math.max(nextRefreshAt, now() + RELEASE_BUILD_STATUS_REFRESH_MS);
          return status;
        })
        .finally(() => {
          inFlight = null;
        });
      return await inFlight;
    },
  };
}

let service: ReleaseBuildStatusService | null = null;

export function getReleaseBuildStatus(version: unknown): Promise<ReleaseBuildStatus | null> {
  service ??= createReleaseBuildStatusService();
  return service.get(typeof version === "string" ? version.replace(/^v/i, "") : "");
}
