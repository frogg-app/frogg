import type { CiRun } from "@frogg/protocol/messages";
import { FroggCiConfigSchema, type FroggCiConfig } from "@frogg/protocol/frogg-config-schema";
import { getErrorMessage } from "@frogg/protocol/error-utils";
import { readFroggConfigJson } from "../../utils/frogg-config-file.js";
import { listGitHubActionsRuns, type GitHubApiGet } from "./github-actions.js";
import { listJenkinsRuns, type FetchLike, type JenkinsCredentials } from "./jenkins.js";

export interface ListCiRunsResult {
  runs: CiRun[];
  providers: string[];
  providerErrors: Array<{ provider: string; message: string }>;
}

export function readCiConfig(repoRoot: string | null): FroggCiConfig {
  if (!repoRoot) return {};
  try {
    const raw = readFroggConfigJson(repoRoot) as { ci?: unknown } | null;
    const parsed = FroggCiConfigSchema.safeParse(raw?.ci ?? {});
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function readJenkinsCredentials(env: NodeJS.ProcessEnv): JenkinsCredentials | null {
  const user = env.FROGG_JENKINS_USER?.trim();
  const token = env.FROGG_JENKINS_TOKEN?.trim();
  return user && token ? { user, token } : null;
}

/**
 * Every configured provider is asked in parallel and one failing does not hide the others: the
 * pane shows what it has plus a line per provider that could not be reached.
 *
 * Providers list the whole project where they can — the pane shows every branch's runs by default
 * and filters to `branch` only when the user asks for it. Jenkins is the exception: a multibranch
 * job is addressed per branch, so it still reports the checkout's branch alone.
 */
/** Panes and clients polling the same repo within this window share one GitHub fetch. */
const GITHUB_SHARED_TTL_MS = 8_000;
/** After GitHub rate-limits us, stop asking for this long and serve the last result. */
const GITHUB_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;

interface GitHubRunsEntry {
  inFlight: Promise<CiRun[]> | null;
  runs: CiRun[] | null;
  fetchedAt: number;
  cooldownUntil: number;
  cooldownMessage: string | null;
}

const githubRunsByRepo = new Map<string, GitHubRunsEntry>();
let now = () => Date.now();

/** Test seam. */
export function resetCiServiceState(clock?: () => number): void {
  githubRunsByRepo.clear();
  now = clock ?? (() => Date.now());
}

export function isRateLimitError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    /\b429\b/.test(message)
  );
}

async function loadGitHubRunsShared(
  key: string,
  load: () => Promise<CiRun[]>,
  at: number,
): Promise<CiRun[]> {
  let entry = githubRunsByRepo.get(key);
  if (!entry) {
    entry = {
      inFlight: null,
      runs: null,
      fetchedAt: 0,
      cooldownUntil: 0,
      cooldownMessage: null,
    };
    githubRunsByRepo.set(key, entry);
  }
  if (entry.inFlight) return entry.inFlight;
  if (at < entry.cooldownUntil) {
    if (entry.runs) return entry.runs;
    throw new Error(entry.cooldownMessage ?? "GitHub rate limit; retrying later");
  }
  if (entry.runs && at - entry.fetchedAt < GITHUB_SHARED_TTL_MS) return entry.runs;
  const current = entry;
  current.inFlight = load()
    .then((runs) => {
      current.runs = runs;
      current.fetchedAt = now();
      return runs;
    })
    .catch((error: unknown) => {
      if (isRateLimitError(error)) {
        current.cooldownUntil = now() + GITHUB_RATE_LIMIT_COOLDOWN_MS;
        current.cooldownMessage = `GitHub rate limit reached; pausing CI refresh for 5 minutes (${getErrorMessage(
          error,
        )})`;
      }
      throw error;
    })
    .finally(() => {
      current.inFlight = null;
    });
  return current.inFlight;
}

export async function listCiRuns(input: {
  /**
   * The checkout's branch: what Jenkins is asked for, and what the pane offers to filter to.
   * Null on a detached HEAD, where GitHub Actions still lists the project and Jenkins is skipped.
   */
  branch: string | null;
  repoRoot: string | null;
  /** Null when the checkout's remote is not on GitHub or `gh` is unavailable. */
  githubApi: GitHubApiGet | null;
  env?: NodeJS.ProcessEnv;
  fetch?: FetchLike;
}): Promise<ListCiRunsResult> {
  const config = readCiConfig(input.repoRoot);
  const tasks: Array<{ provider: string; load: () => Promise<CiRun[]> }> = [];
  const githubApi = input.githubApi;
  if (githubApi && config.githubActions !== false) {
    const key = input.repoRoot ?? "";
    tasks.push({
      provider: "githubActions",
      load: () => loadGitHubRunsShared(key, () => listGitHubActionsRuns({ api: githubApi }), now()),
    });
  }
  const jenkins = config.jenkins;
  const jenkinsBranch = input.branch;
  if (jenkins && jenkinsBranch !== null) {
    tasks.push({
      provider: "jenkins",
      load: () =>
        listJenkinsRuns({
          config: jenkins,
          branch: jenkinsBranch,
          credentials: readJenkinsCredentials(input.env ?? process.env),
          fetch: input.fetch,
        }),
    });
  }

  const settled = await Promise.allSettled(tasks.map((task) => task.load()));
  const result: ListCiRunsResult = {
    runs: [],
    providers: tasks.map((task) => task.provider),
    providerErrors: [],
  };
  settled.forEach((outcome, index) => {
    const provider = tasks[index]?.provider ?? "unknown";
    if (outcome.status === "fulfilled") result.runs.push(...outcome.value);
    else
      result.providerErrors.push({
        provider,
        message: getErrorMessage(outcome.reason),
      });
  });
  return result;
}
