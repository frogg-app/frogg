import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseReleaseBuildStatus, releaseBuildFraction } from "./release-build-status";

describe("parseReleaseBuildStatus", () => {
  it("parses a running job", () => {
    const status = parseReleaseBuildStatus({
      version: "1.2.3",
      state: "running",
      jobName: "desktop linux x86_64",
      completedSteps: 4,
      totalSteps: 11,
      currentStep: "Build",
      startedAt: 1_700_000_000_000,
      url: "https://github.com/acme/app/actions/runs/1/job/2",
    });
    assert.equal(status?.completedSteps, 4);
    assert.equal(releaseBuildFraction(status!), 4 / 11);
  });

  it("rejects payloads without the fields the card renders", () => {
    assert.equal(parseReleaseBuildStatus(null), null);
    assert.equal(parseReleaseBuildStatus({ state: "running", jobName: "x" }), null);
    assert.equal(parseReleaseBuildStatus({ state: "done", jobName: "x", version: "1" }), null);
  });

  it("clamps a step count that exceeds the total and drops blank fields", () => {
    const status = parseReleaseBuildStatus({
      version: "1.2.3",
      state: "queued",
      jobName: "desktop windows x86_64",
      completedSteps: 9,
      totalSteps: 0,
      currentStep: "  ",
      startedAt: 0,
      url: "",
    });
    assert.equal(status?.completedSteps, 0);
    assert.equal(status?.currentStep, null);
    assert.equal(status?.url, null);
    // A queued job has no steps yet, so the bar stays indeterminate.
    assert.equal(releaseBuildFraction(status!), null);
  });
});
