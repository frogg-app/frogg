import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  createReleaseBuildStatusService,
  parseGithubJobs,
  resolveDesktopJobName,
  selectRunIdForTag,
  summarizeJob,
} from "./release-build-status.js";

function job(overrides: Record<string, unknown> = {}) {
  return {
    name: "desktop macos aarch64",
    status: "in_progress",
    conclusion: null,
    started_at: "2026-09-23T10:00:00Z",
    html_url: "https://github.com/acme/app/actions/runs/1/job/2",
    steps: [
      { name: "Set up job", status: "completed", conclusion: "success" },
      { name: "Build", status: "in_progress", conclusion: null },
      { name: "Upload", status: "queued", conclusion: null },
    ],
    ...overrides,
  };
}

describe("resolveDesktopJobName", () => {
  it("maps runtimes onto the release matrix job names", () => {
    assert.equal(resolveDesktopJobName("darwin", "arm64"), "desktop macos aarch64");
    assert.equal(resolveDesktopJobName("darwin", "x64"), "desktop macos x86_64");
    assert.equal(resolveDesktopJobName("linux", "x64"), "desktop linux x86_64");
    // Windows on arm64 installs and runs the x64 build, so it follows that job.
    assert.equal(resolveDesktopJobName("win32", "arm64"), "desktop windows x86_64");
    assert.equal(resolveDesktopJobName("linux", "arm64"), null);
    assert.equal(resolveDesktopJobName("aix", "x64"), null);
  });
});

describe("selectRunIdForTag", () => {
  it("picks the newest run for the tag and ignores other refs", () => {
    const payload = {
      workflow_runs: [
        { id: 1, head_branch: "v1.2.3", run_started_at: "2026-09-23T09:00:00Z" },
        { id: 2, head_branch: "main", run_started_at: "2026-09-23T11:00:00Z" },
        { id: 3, head_branch: "v1.2.3", run_started_at: "2026-09-23T10:00:00Z" },
      ],
    };
    assert.equal(selectRunIdForTag(payload, "v1.2.3"), 3);
    assert.equal(selectRunIdForTag(payload, "v9.9.9"), null);
    assert.equal(selectRunIdForTag({}, "v1.2.3"), null);
  });
});

describe("summarizeJob", () => {
  it("counts finished steps and names the running one", () => {
    const status = summarizeJob(parseGithubJobs({ jobs: [job()] })[0]!, "1.2.3");
    assert.equal(status.state, "running");
    assert.equal(status.completedSteps, 1);
    assert.equal(status.totalSteps, 3);
    assert.equal(status.currentStep, "Build");
  });

  it("fills the bar for a successful job even when steps were skipped", () => {
    const raw = job({
      status: "completed",
      conclusion: "success",
      steps: [
        { name: "Set up job", status: "completed", conclusion: "success" },
        { name: "Sign", status: "completed", conclusion: "skipped" },
      ],
    });
    const status = summarizeJob(parseGithubJobs({ jobs: [raw] })[0]!, "1.2.3");
    assert.equal(status.state, "succeeded");
    assert.equal(status.completedSteps, 2);
  });

  it("reports a non-success conclusion as failed", () => {
    const raw = job({ status: "completed", conclusion: "cancelled" });
    assert.equal(summarizeJob(parseGithubJobs({ jobs: [raw] })[0]!, "1.2.3").state, "failed");
    const queued = job({ status: "queued", steps: [] });
    const status = summarizeJob(parseGithubJobs({ jobs: [queued] })[0]!, "1.2.3");
    assert.equal(status.state, "queued");
    assert.equal(status.totalSteps, 0);
  });
});

describe("createReleaseBuildStatusService", () => {
  function deps(responses: Map<string, unknown>, clock = { value: 0 }) {
    const urls: string[] = [];
    const service = createReleaseBuildStatusService({
      repository: "acme/app",
      platform: "darwin",
      arch: "arm64",
      now: () => clock.value,
      fetchJson: async (url) => {
        urls.push(url);
        const payload = responses.get(url);
        if (payload === undefined) throw new Error(`Unexpected request: ${url}`);
        return { payload, retryAfterMs: null };
      },
    });
    return { service, urls, clock };
  }

  const responses = new Map<string, unknown>([
    [
      "https://api.github.com/repos/acme/app/actions/runs?per_page=30",
      { workflow_runs: [{ id: 7, head_branch: "v1.2.3", run_started_at: "2026-09-23T10:00:00Z" }] },
    ],
    ["https://api.github.com/repos/acme/app/actions/runs/7/jobs?per_page=100", { jobs: [job()] }],
  ]);

  it("caches between refreshes and reuses the resolved run id", async () => {
    const clock = { value: 1_000 };
    const { service, urls } = deps(responses, clock);

    assert.equal((await service.get("1.2.3"))?.currentStep, "Build");
    assert.equal(urls.length, 2);

    await service.get("1.2.3");
    assert.equal(urls.length, 2, "a cached answer makes no requests");

    clock.value += 120_000;
    await service.get("1.2.3");
    assert.deepEqual(urls.slice(2), [
      "https://api.github.com/repos/acme/app/actions/runs/7/jobs?per_page=100",
    ]);
  });

  it("returns null without a repository or a job for this runtime", async () => {
    const withoutRepo = createReleaseBuildStatusService({ repository: null });
    assert.equal(await withoutRepo.get("1.2.3"), null);
    const unsupported = createReleaseBuildStatusService({
      repository: "acme/app",
      platform: "linux",
      arch: "arm64",
      fetchJson: async () => assert.fail("no request expected"),
    });
    assert.equal(await unsupported.get("1.2.3"), null);
  });

  it("backs off and keeps the last answer when rate limited", async () => {
    const clock = { value: 0 };
    let rateLimited = false;
    const service = createReleaseBuildStatusService({
      repository: "acme/app",
      platform: "darwin",
      arch: "arm64",
      now: () => clock.value,
      fetchJson: async (url) => {
        if (rateLimited) return { payload: null, retryAfterMs: 600_000 };
        return { payload: responses.get(url), retryAfterMs: null };
      },
    });

    assert.equal((await service.get("1.2.3"))?.state, "running");
    rateLimited = true;
    clock.value += 120_000;
    assert.equal((await service.get("1.2.3"))?.state, "running");
    clock.value += 120_000;
    assert.equal((await service.get("1.2.3"))?.state, "running", "still inside the back-off");
  });

  it("survives a failed request by keeping the cached status", async () => {
    const clock = { value: 0 };
    let failing = false;
    const service = createReleaseBuildStatusService({
      repository: "acme/app",
      platform: "darwin",
      arch: "arm64",
      now: () => clock.value,
      fetchJson: async (url) => {
        if (failing) throw new Error("offline");
        return { payload: responses.get(url), retryAfterMs: null };
      },
    });
    await service.get("1.2.3");
    failing = true;
    clock.value += 120_000;
    assert.equal((await service.get("1.2.3"))?.state, "running");
  });
});
