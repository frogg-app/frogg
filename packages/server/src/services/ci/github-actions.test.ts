import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGitHubActionsJobsCache,
  listGitHubActionsRuns,
  mapGitHubStatus,
} from "./github-actions.js";
import { listCiRuns, resetCiServiceState } from "./ci-service.js";

beforeEach(() => {
  clearGitHubActionsJobsCache();
  resetCiServiceState();
});

function fakeApi(responses: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    api: async (path: string) => {
      calls.push(path);
      const key = Object.keys(responses).find((prefix) => path.startsWith(prefix));
      if (!key) throw new Error(`unexpected ${path}`);
      return responses[key];
    },
  };
}

describe("mapGitHubStatus", () => {
  it("folds status and conclusion into one vocabulary", () => {
    expect(mapGitHubStatus("in_progress")).toBe("running");
    expect(mapGitHubStatus("waiting")).toBe("queued");
    expect(mapGitHubStatus("completed", "success")).toBe("success");
    expect(mapGitHubStatus("completed", "timed_out")).toBe("failure");
    expect(mapGitHubStatus("completed", "cancelled")).toBe("cancelled");
    expect(mapGitHubStatus("completed", "skipped")).toBe("skipped");
  });
});

describe("listGitHubActionsRuns", () => {
  it("keeps the newest run per workflow and branch and derives progress from finished steps", async () => {
    const { api, calls } = fakeApi({
      "repos/{owner}/{repo}/actions/runs?": {
        workflow_runs: [
          {
            id: 2,
            name: "CI",
            workflow_id: 10,
            run_number: 42,
            event: "push",
            status: "in_progress",
            head_branch: "feature/x",
            html_url: "https://gh/run/2",
            run_started_at: "2026-09-19T10:00:00Z",
          },
          {
            id: 1,
            name: "CI",
            workflow_id: 10,
            run_number: 41,
            event: "push",
            status: "completed",
            conclusion: "failure",
            head_branch: "feature/x",
          },
        ],
      },
      "repos/{owner}/{repo}/actions/runs/2/jobs": {
        jobs: [
          {
            id: 7,
            name: "test",
            status: "in_progress",
            runner_name: "GitHub Actions 3",
            runner_group_name: "GitHub Actions",
            labels: ["ubuntu-latest"],
            steps: [
              { name: "Checkout", status: "completed", conclusion: "success" },
              { name: "Run tests", status: "in_progress" },
              { name: "Report", status: "queued" },
              { name: "Post", status: "queued" },
            ],
          },
          {
            id: 8,
            name: "lint",
            status: "completed",
            conclusion: "success",
            runner_name: "box",
            runner_group_name: "Default",
            labels: ["self-hosted"],
            steps: [],
          },
        ],
      },
    });

    const runs = await listGitHubActionsRuns({ api });

    // Project-wide: the pane filters to a branch itself, so the query must not do it first.
    expect(calls[0]).not.toContain("branch=");
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run).toMatchObject({
      pipeline: "CI",
      number: 42,
      status: "running",
      trigger: "push",
      branch: "feature/x",
      url: "https://gh/run/2",
    });
    expect(run?.jobs[0]).toMatchObject({
      status: "running",
      progress: 0.25,
      runner: { name: "GitHub Actions 3", hosted: true },
    });
    expect(run?.jobs[1]).toMatchObject({
      status: "success",
      progress: 1,
      runner: { hosted: false },
    });
    expect(run?.progress).toBeCloseTo(0.625);
  });
});

describe("listGitHubActionsRuns across branches", () => {
  it("keeps the newest run of a workflow on each branch", async () => {
    const { api } = fakeApi({
      "repos/{owner}/{repo}/actions/runs?": {
        workflow_runs: [
          {
            id: 3,
            name: "CI",
            workflow_id: 10,
            run_number: 9,
            status: "completed",
            conclusion: "success",
            head_branch: "main",
          },
          {
            id: 2,
            name: "CI",
            workflow_id: 10,
            run_number: 8,
            status: "completed",
            conclusion: "success",
            head_branch: "feature/x",
          },
          {
            id: 1,
            name: "CI",
            workflow_id: 10,
            run_number: 7,
            status: "completed",
            conclusion: "failure",
            head_branch: "main",
          },
        ],
      },
      "repos/{owner}/{repo}/actions/runs/3/jobs": { jobs: [] },
      "repos/{owner}/{repo}/actions/runs/2/jobs": { jobs: [] },
    });

    const runs = await listGitHubActionsRuns({ api });

    expect(runs.map((entry) => [entry.branch, entry.number])).toEqual([
      ["main", 9],
      ["feature/x", 8],
    ]);
  });
});

describe("GitHub Actions request volume", () => {
  const run = (id: number, status: string, updatedAt = "2026-01-01T00:00:00Z") => ({
    id,
    name: "CI",
    workflow_id: id,
    run_number: id,
    status,
    conclusion: status === "completed" ? "success" : null,
    head_branch: "main",
    updated_at: updatedAt,
  });

  it("fetches jobs for a finished run once and re-fetches running ones", async () => {
    const calls: string[] = [];
    const api = async (path: string) => {
      calls.push(path);
      if (path.includes("/jobs")) return { jobs: [] };
      return { workflow_runs: [run(1, "completed"), run(2, "in_progress")] };
    };
    await listGitHubActionsRuns({ api });
    await listGitHubActionsRuns({ api });
    expect(calls.filter((p) => p.includes("runs/1/jobs"))).toHaveLength(1);
    expect(calls.filter((p) => p.includes("runs/2/jobs"))).toHaveLength(2);
  });

  it("shares one fetch across concurrent callers and backs off after a rate limit", async () => {
    let clock = 0;
    resetCiServiceState(() => clock);
    let calls = 0;
    let fail = false;
    const githubApi = async (path: string) => {
      calls++;
      if (fail) throw new Error("gh: HTTP 429: You have exceeded a secondary rate limit");
      return path.includes("/jobs") ? { jobs: [] } : { workflow_runs: [run(1, "completed")] };
    };
    const list = () => listCiRuns({ branch: "main", repoRoot: "/repo", githubApi });
    await Promise.all([list(), list(), list()]);
    expect(calls).toBe(2);

    clock = 60_000;
    fail = true;
    const limited = await list();
    expect(limited.providerErrors).toHaveLength(1);
    const before = calls;
    clock = 120_000;
    const cooled = await list();
    expect(calls).toBe(before);
    expect(cooled.runs).toHaveLength(1);
  });
});
