import { describe, expect, it } from "vitest";
import { effectiveLastUpdateResult } from "./daemon-update-outcome";

const failed = {
  from: "1.5.6",
  to: "1.5.7",
  status: "failed" as const,
  reason: "timed out after 90s: daemon reports version 0.6.13, expected 1.5.7",
  at: "2026-09-19T12:41:17.488Z",
};

describe("effectiveLastUpdateResult", () => {
  it("shows a failure at the running version as applied", () => {
    expect(effectiveLastUpdateResult({ lastResult: failed, currentVersion: "1.5.7" })).toEqual({
      ...failed,
      status: "applied",
      reason: null,
    });
  });

  it("keeps a failure while the daemon is still on another version", () => {
    expect(effectiveLastUpdateResult({ lastResult: failed, currentVersion: "1.5.6" })).toBe(failed);
    expect(effectiveLastUpdateResult(null)).toBeNull();
  });
});
