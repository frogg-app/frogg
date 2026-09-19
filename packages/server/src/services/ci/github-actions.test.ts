import { describe, expect, it } from "vitest";
import { listGitHubActionsRuns, mapGitHubStatus } from "./github-actions.js";

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
  it("keeps the newest run per workflow and derives progress from finished steps", async () => {
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

    const runs = await listGitHubActionsRuns({ api, branch: "feature/x" });

    expect(calls[0]).toContain("branch=feature%2Fx");
    expect(runs).toHaveLength(1);
    const [run] = runs;
    expect(run).toMatchObject({
      pipeline: "CI",
      number: 42,
      status: "running",
      trigger: "push",
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
