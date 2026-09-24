import { z } from "zod";
import type { CiJob, CiRun } from "@frogg/protocol/messages";

/** `gh api <path>` for the checkout, parsed as JSON. `{owner}/{repo}` resolve from the remote. */
export type GitHubApiGet = (path: string) => Promise<unknown>;

const StepSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable().optional(),
});

const JobSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable().optional(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
  runner_name: z.string().nullable().optional(),
  runner_group_name: z.string().nullable().optional(),
  labels: z.array(z.string()).optional(),
  steps: z.array(StepSchema).optional(),
});

const RunSchema = z.object({
  id: z.number(),
  name: z.string().nullable().optional(),
  workflow_id: z.number(),
  run_number: z.number(),
  event: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),
  html_url: z.string().nullable().optional(),
  head_branch: z.string().nullable().optional(),
  run_started_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

const RunsResponseSchema = z.object({ workflow_runs: z.array(RunSchema) });
const JobsResponseSchema = z.object({ jobs: z.array(JobSchema) });

/**
 * One run per workflow *per branch*: the newest, since older ones on the same branch are
 * superseded. The pane lists the whole project rather than only the checkout's branch, so the
 * cap is on runs rather than workflows.
 */
const MAX_RUNS = 20;

/**
 * GitHub reports `status` and, once completed, `conclusion`. The pane speaks one vocabulary for
 * every provider, so both collapse into it here.
 */
export function mapGitHubStatus(status: string | null | undefined, conclusion?: string | null) {
  switch (status) {
    case "completed":
      switch (conclusion) {
        case "success":
          return "success";
        case "cancelled":
          return "cancelled";
        case "skipped":
        case "neutral":
          return "skipped";
        default:
          return "failure";
      }
    case "in_progress":
      return "running";
    default:
      return "queued";
  }
}

function toJob(job: z.infer<typeof JobSchema>): CiJob {
  const status = mapGitHubStatus(job.status, job.conclusion);
  const steps = (job.steps ?? []).map((step) => ({
    name: step.name,
    status: mapGitHubStatus(step.status, step.conclusion),
  }));
  let progress: number | null;
  if (status === "queued") progress = 0;
  else if (status !== "running") progress = 1;
  else if (steps.length === 0) progress = null;
  else
    progress =
      steps.filter((step) => step.status !== "queued" && step.status !== "running").length /
      steps.length;
  const hosted = job.runner_group_name === "GitHub Actions";
  return {
    id: `githubActions:job:${job.id}`,
    name: job.name,
    status,
    progress,
    startedAt: job.started_at ?? null,
    completedAt: job.completed_at ?? null,
    url: job.html_url ?? null,
    runner: job.runner_name ? { name: job.runner_name, hosted, labels: job.labels ?? [] } : null,
    steps,
  };
}

export function summarizeRunProgress(status: string, jobs: CiJob[]): number | null {
  if (status !== "running" && status !== "queued") return 1;
  const known = jobs.map((job) => job.progress).filter((value): value is number => value !== null);
  if (known.length === 0) return status === "queued" ? 0 : null;
  return known.reduce((sum, value) => sum + value, 0) / jobs.length;
}

/** Every workflow run in the project, newest per workflow and branch. */
export async function listGitHubActionsRuns(input: { api: GitHubApiGet }): Promise<CiRun[]> {
  const runsResponse = RunsResponseSchema.parse(
    await input.api(`repos/{owner}/{repo}/actions/runs?per_page=100`),
  );
  const latestPerWorkflow = new Map<string, z.infer<typeof RunSchema>>();
  for (const run of runsResponse.workflow_runs) {
    const key = `${run.workflow_id}:${run.head_branch ?? ""}`;
    if (!latestPerWorkflow.has(key)) latestPerWorkflow.set(key, run);
  }
  const runs = [...latestPerWorkflow.values()].slice(0, MAX_RUNS);
  return Promise.all(
    runs.map(async (run) => {
      const jobsResponse = JobsResponseSchema.parse(
        await input.api(
          `repos/{owner}/{repo}/actions/runs/${run.id}/jobs?per_page=100&filter=latest`,
        ),
      );
      const jobs = jobsResponse.jobs.map(toJob);
      const status = mapGitHubStatus(run.status, run.conclusion);
      return {
        id: `githubActions:run:${run.id}`,
        provider: "githubActions",
        pipeline: run.name ?? "Workflow",
        branch: run.head_branch ?? null,
        number: run.run_number,
        trigger: run.event ?? null,
        status,
        progress: summarizeRunProgress(status, jobs),
        startedAt: run.run_started_at ?? null,
        completedAt: status === "running" || status === "queued" ? null : (run.updated_at ?? null),
        url: run.html_url ?? null,
        jobs,
      } satisfies CiRun;
    }),
  );
}

/** `gh api <path>` for the checkout, returned as text (job logs are plain text, not JSON). */
export type GitHubApiGetText = (path: string) => Promise<string>;

const JOB_ID_PREFIX = "githubActions:job:";

/** The numeric GitHub job id inside a `githubActions:job:<id>` CI job id, or null. */
export function parseGitHubActionsJobId(id: string): number | null {
  if (!id.startsWith(JOB_ID_PREFIX)) return null;
  const value = Number(id.slice(JOB_ID_PREFIX.length));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// oxlint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001b\[[0-9;]*[A-Za-z]/g;
const LINE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /;

/**
 * A job log as an agent should read it: without the per-line ISO timestamps and
 * terminal colour codes GitHub keeps, which roughly double the token count and
 * carry nothing a reader needs.
 */
export function cleanGitHubActionsLog(raw: string): string {
  return raw
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((line) => line.replace(LINE_TIMESTAMP, "").replace(ANSI_ESCAPE, ""))
    .join("\n");
}

export async function fetchGitHubActionsJobLog(input: {
  apiText: GitHubApiGetText;
  jobId: number;
}): Promise<string> {
  const raw = await input.apiText(`repos/{owner}/{repo}/actions/jobs/${input.jobId}/logs`);
  return cleanGitHubActionsLog(raw);
}
