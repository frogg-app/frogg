import { describe, expect, it } from "vitest";
import { CHECK_TRAIT_MANUAL } from "@frogg/protocol/check-traits";
import {
  EMPTY_CHECKS_PROGRESS,
  mergeChecksProgress,
  summarizeChecksProgress,
} from "./checks-progress";

describe("summarizeChecksProgress", () => {
  it("reads an empty run as idle rather than NaN", () => {
    expect(summarizeChecksProgress([])).toEqual(EMPTY_CHECKS_PROGRESS);
    expect(summarizeChecksProgress(null)).toEqual(EMPTY_CHECKS_PROGRESS);
    expect(summarizeChecksProgress(undefined)).toEqual(EMPTY_CHECKS_PROGRESS);
  });

  it("counts reported checks as progress and keeps running until the last one lands", () => {
    const progress = summarizeChecksProgress([
      { status: "success" },
      { status: "failure" },
      { status: "pending" },
      { status: "pending" },
    ]);
    expect(progress).toEqual({ total: 4, completed: 2, fraction: 0.5, running: true });
  });

  it("counts skipped and cancelled checks as finished, so the ring can reach full", () => {
    const progress = summarizeChecksProgress([
      { status: "success" },
      { status: "skipped" },
      { status: "cancelled" },
    ]);
    expect(progress).toEqual({ total: 3, completed: 3, fraction: 1, running: false });
  });

  it("counts a manual gate as reported — it waits on a person, not on CI", () => {
    const progress = summarizeChecksProgress([
      { status: "success" },
      { status: "pending", traits: [CHECK_TRAIT_MANUAL] },
    ]);
    expect(progress.completed).toBe(2);
  });
});

describe("mergeChecksProgress", () => {
  it("rolls several runs into one fraction", () => {
    const merged = mergeChecksProgress([
      { total: 4, completed: 1, fraction: 0.25, running: true },
      { total: 6, completed: 5, fraction: 5 / 6, running: true },
    ]);
    expect(merged).toEqual({ total: 10, completed: 6, fraction: 0.6, running: true });
  });

  it("is idle when nothing is running", () => {
    expect(mergeChecksProgress([])).toEqual(EMPTY_CHECKS_PROGRESS);
    expect(
      mergeChecksProgress([{ total: 2, completed: 2, fraction: 1, running: false }]).running,
    ).toBe(false);
  });
});
