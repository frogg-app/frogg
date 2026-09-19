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
 */
export async function listCiRuns(input: {
  branch: string;
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
    tasks.push({
      provider: "githubActions",
      load: () => listGitHubActionsRuns({ api: githubApi, branch: input.branch }),
    });
  }
  const jenkins = config.jenkins;
  if (jenkins) {
    tasks.push({
      provider: "jenkins",
      load: () =>
        listJenkinsRuns({
          config: jenkins,
          branch: input.branch,
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
    else result.providerErrors.push({ provider, message: getErrorMessage(outcome.reason) });
  });
  return result;
}
