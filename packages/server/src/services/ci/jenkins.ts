import { z } from "zod";
import type { CiJob, CiRun } from "@frogg/protocol/messages";
import type { FroggCiConfig } from "@frogg/protocol/frogg-config-schema";

export type JenkinsConfig = NonNullable<FroggCiConfig["jenkins"]>;

export interface JenkinsCredentials {
  user: string;
  token: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 10_000;

const BuildSchema = z.object({
  number: z.number(),
  url: z.string(),
  building: z.boolean(),
  result: z.string().nullable().optional(),
  timestamp: z.number(),
  duration: z.number().optional(),
  estimatedDuration: z.number().optional(),
  builtOn: z.string().nullable().optional(),
  actions: z
    .array(
      z
        .object({
          causes: z.array(z.object({ shortDescription: z.string().optional() })).optional(),
        })
        .passthrough()
        .nullable(),
    )
    .optional(),
});

const JobResponseSchema = z.object({
  displayName: z.string().optional(),
  lastBuild: BuildSchema.nullable().optional(),
});

const StagesSchema = z.object({
  stages: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      status: z.string(),
      startTimeMillis: z.number().optional(),
      durationMillis: z.number().optional(),
    }),
  ),
});

export class JenkinsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/**
 * Jenkins nests every job, folder and multibranch branch under its own `job/` segment. Branch
 * names are encoded twice because a multibranch project stores `feature/x` as `feature%2Fx`.
 */
export function buildJenkinsJobUrl(config: JenkinsConfig, branch: string): string {
  const base = config.url.replace(/\/+$/, "");
  const segments = config.job
    .split("/")
    .filter(Boolean)
    .map((part) => `job/${encodeURIComponent(part)}`);
  if (config.multibranch !== false) {
    segments.push(`job/${encodeURIComponent(encodeURIComponent(branch))}`);
  }
  return `${base}/${segments.join("/")}/`;
}

export function mapJenkinsResult(building: boolean, result: string | null | undefined): string {
  if (building) return "running";
  switch (result) {
    case "SUCCESS":
      return "success";
    case "ABORTED":
      return "cancelled";
    case "NOT_BUILT":
      return "skipped";
    case null:
    case undefined:
      return "queued";
    default:
      return "failure";
  }
}

export function mapJenkinsStageStatus(status: string): string {
  switch (status) {
    case "SUCCESS":
      return "success";
    case "IN_PROGRESS":
    case "PAUSED_PENDING_INPUT":
      return "running";
    case "ABORTED":
      return "cancelled";
    case "NOT_EXECUTED":
      return "skipped";
    case "FAILED":
    case "UNSTABLE":
      return "failure";
    default:
      return "queued";
  }
}

function stageProgress(status: string): number | null {
  // Jenkins gives a build-level estimate but nothing per stage, so a running stage has none.
  if (status === "running") return null;
  return status === "queued" ? 0 : 1;
}

async function getJson(
  fetchImpl: FetchLike,
  url: string,
  credentials: JenkinsCredentials | null,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (credentials) {
    const token = Buffer.from(`${credentials.user}:${credentials.token}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const reason =
      response.status === 401 || response.status === 403
        ? "Jenkins rejected the credentials (set FROGG_JENKINS_USER and FROGG_JENKINS_TOKEN on the daemon host)"
        : `Jenkins returned HTTP ${response.status}`;
    throw new JenkinsRequestError(reason, response.status);
  }
  return response.json();
}

/**
 * The latest build of the branch's job, with one CI job per pipeline stage. A freestyle job has
 * no stages, so it reports as a single job named after the build.
 */
export async function listJenkinsRuns(input: {
  config: JenkinsConfig;
  branch: string;
  credentials: JenkinsCredentials | null;
  fetch?: FetchLike;
  now?: number;
}): Promise<CiRun[]> {
  const fetchImpl = input.fetch ?? fetch;
  const jobUrl = buildJenkinsJobUrl(input.config, input.branch);
  const tree =
    "displayName,lastBuild[number,url,building,result,timestamp,duration,estimatedDuration,builtOn,actions[causes[shortDescription]]]";
  let job: z.infer<typeof JobResponseSchema>;
  try {
    job = JobResponseSchema.parse(
      await getJson(
        fetchImpl,
        `${jobUrl}api/json?tree=${encodeURIComponent(tree)}`,
        input.credentials,
      ),
    );
  } catch (error) {
    // A branch Jenkins has never built has no job; that is "no runs", not a failure.
    if (error instanceof JenkinsRequestError && error.status === 404) return [];
    throw error;
  }
  const build = job.lastBuild;
  if (!build) return [];

  const now = input.now ?? Date.now();
  const status = mapJenkinsResult(build.building, build.result);
  const runner = {
    name: build.builtOn ? build.builtOn : "built-in",
    hosted: false,
    labels: [],
  };
  let progress: number | null = 1;
  if (status === "running") {
    progress =
      build.estimatedDuration && build.estimatedDuration > 0
        ? Math.min(0.99, (now - build.timestamp) / build.estimatedDuration)
        : null;
  }

  let jobs: CiJob[];
  try {
    const stages = StagesSchema.parse(
      await getJson(fetchImpl, `${build.url}wfapi/describe`, input.credentials),
    );
    jobs = stages.stages.map((stage) => {
      const mapped = mapJenkinsStageStatus(stage.status);
      // Jenkins reports stages it has not reached yet as NOT_EXECUTED; mid-build that is "later",
      // not "skipped".
      const stageStatus = mapped === "skipped" && status === "running" ? "queued" : mapped;
      const startedAt = stage.startTimeMillis
        ? new Date(stage.startTimeMillis).toISOString()
        : null;
      const finished = stageStatus !== "running" && stageStatus !== "queued";
      return {
        id: `jenkins:stage:${build.url}:${stage.id}`,
        name: stage.name,
        status: stageStatus,
        progress: stageProgress(stageStatus),
        startedAt,
        completedAt:
          finished && stage.startTimeMillis !== undefined && stage.durationMillis !== undefined
            ? new Date(stage.startTimeMillis + stage.durationMillis).toISOString()
            : null,
        url: `${build.url}execution/node/${stage.id}/`,
        runner: stageStatus === "queued" ? null : runner,
        steps: [],
      };
    });
  } catch {
    jobs = [
      {
        id: `jenkins:build:${build.url}`,
        name: job.displayName ?? input.config.job,
        status,
        progress,
        startedAt: new Date(build.timestamp).toISOString(),
        completedAt: null,
        url: build.url,
        runner,
        steps: [],
      },
    ];
  }

  const cause = build.actions
    ?.flatMap((action) => action?.causes ?? [])
    .find((entry) => entry.shortDescription)?.shortDescription;
  return [
    {
      id: `jenkins:build:${build.url}`,
      provider: "jenkins",
      pipeline: job.displayName ?? input.config.job,
      number: build.number,
      trigger: cause ?? null,
      status,
      progress,
      startedAt: new Date(build.timestamp).toISOString(),
      completedAt:
        status === "running" || build.duration === undefined
          ? null
          : new Date(build.timestamp + build.duration).toISOString(),
      url: build.url,
      jobs,
    },
  ];
}
