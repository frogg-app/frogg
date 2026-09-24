import { describe, expect, it } from "vitest";
import { formatAutoResumeCountdown, formatAutoResumeDuration } from "./countdown";

const MIN = 60_000;

describe("formatAutoResumeCountdown", () => {
  it("shows minutes alone under an hour", () => {
    expect(formatAutoResumeCountdown(14 * MIN)).toBe("14m");
    expect(formatAutoResumeCountdown(13 * MIN + 1)).toBe("14m");
    expect(formatAutoResumeCountdown(0)).toBe("1m");
  });

  it("adds hours and days only when needed", () => {
    expect(formatAutoResumeCountdown(134 * MIN)).toBe("2:14");
    expect(formatAutoResumeCountdown((24 * 60 + 134) * MIN)).toBe("1:02:14");
  });
});

describe("formatAutoResumeDuration", () => {
  it("spells out the remaining time", () => {
    expect(formatAutoResumeDuration(14 * MIN)).toBe("14m");
    expect(formatAutoResumeDuration(134 * MIN)).toBe("2h 14m");
    expect(formatAutoResumeDuration((24 * 60 + 14) * MIN)).toBe("1d 0h 14m");
  });
});
