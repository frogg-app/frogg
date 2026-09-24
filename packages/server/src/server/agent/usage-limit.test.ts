import { describe, expect, it } from "vitest";
import { detectUsageLimitFromText } from "./usage-limit.js";

const NOW = new Date("2026-09-24T10:00:00.000Z");

describe("detectUsageLimitFromText", () => {
  it("ignores ordinary failures", () => {
    expect(detectUsageLimitFromText("Claude run failed with code 1", NOW)).toBeNull();
    expect(detectUsageLimitFromText(null, NOW)).toBeNull();
  });

  it("reads Claude's epoch-suffixed notice", () => {
    expect(detectUsageLimitFromText("Claude AI usage limit reached|1790330400", NOW)).toEqual({
      resetsAt: new Date(1790330400 * 1000).toISOString(),
    });
  });

  it("reads a relative Codex reset", () => {
    expect(
      detectUsageLimitFromText(
        "You've hit your usage limit. Upgrade to Pro, or try again in 2 hours 5 minutes.",
        NOW,
      ),
    ).toEqual({ resetsAt: "2026-09-24T12:05:00.000Z" });
  });

  it("reads an absolute Codex reset", () => {
    const signal = detectUsageLimitFromText(
      "You've hit your usage limit. Try again at Sep 25th, 2026 3:05 PM.",
      NOW,
    );
    expect(signal?.resetsAt).toBe(new Date("Sep 25, 2026 3:05 PM").toISOString());
  });

  it("detects a limit without a stated reset", () => {
    expect(detectUsageLimitFromText("You've hit your limit", NOW)).toEqual({ resetsAt: null });
  });
});
