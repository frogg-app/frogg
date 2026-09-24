import { describe, expect, it } from "vitest";
import type { CiJob } from "./model";
import { isJobLogAttachable } from "./use-ci-job-log-to-chat";

function job(id: string, status: CiJob["status"]): CiJob {
  return {
    id,
    name: "unit tests",
    status,
    progress: null,
    startedAt: null,
    completedAt: null,
    url: null,
    runner: null,
    steps: [],
  };
}

describe("isJobLogAttachable", () => {
  it("offers finished GitHub Actions jobs only", () => {
    expect(isJobLogAttachable(job("githubActions:job:1", "success"))).toBe(true);
    expect(isJobLogAttachable(job("githubActions:job:1", "failure"))).toBe(true);
    // GitHub serves no log until the job ends.
    expect(isJobLogAttachable(job("githubActions:job:1", "running"))).toBe(false);
    expect(isJobLogAttachable(job("githubActions:job:1", "queued"))).toBe(false);
    expect(isJobLogAttachable(job("jenkins:job:1", "success"))).toBe(false);
  });
});
