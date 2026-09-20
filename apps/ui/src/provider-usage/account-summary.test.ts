import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { formatCountdown, formatWindowSummary, summarizeProviderUsage } from "./account-summary";
import type { ProviderUsage } from "./types";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function inMs(ms: number): string {
  return new Date(NOW.getTime() + ms).toISOString();
}

function usage(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    providerId: "claude",
    displayName: "Claude",
    status: "available",
    planLabel: null,
    windows: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("formatCountdown", () => {
  it("renders days with hours, hours with minutes, and minutes alone", () => {
    expect(formatCountdown(inMs(4 * 86_400_000 + 2 * 3_600_000))).toBe("4d 2h");
    expect(formatCountdown(inMs(3 * 3_600_000 + 10 * 60_000))).toBe("3h 10m");
    expect(formatCountdown(inMs(12 * 60_000))).toBe("12m");
  });

  it("drops a zero remainder", () => {
    expect(formatCountdown(inMs(4 * 86_400_000))).toBe("4d");
    expect(formatCountdown(inMs(2 * 3_600_000))).toBe("2h");
  });

  it("reports a window at or past its reset as resetting now", () => {
    expect(formatCountdown(inMs(-1000))).toBe("now");
  });

  it("returns null for absent or unparseable timestamps", () => {
    expect(formatCountdown(null)).toBeNull();
    expect(formatCountdown(undefined)).toBeNull();
    expect(formatCountdown("not a date")).toBeNull();
  });
});

describe("formatWindowSummary", () => {
  it("names the window, its used percentage and its reset", () => {
    expect(
      formatWindowSummary({
        id: "five_hour",
        label: "Session",
        usedPct: 42,
        resetsAt: inMs(3 * 3_600_000),
      }),
    ).toBe("Session 42% · 3h");
  });

  it("derives the used percentage from the remaining one", () => {
    expect(formatWindowSummary({ id: "weekly", label: "Weekly", remainingPct: 82 })).toBe(
      "Weekly 18%",
    );
  });

  it("shows a dash when only the reset is known", () => {
    expect(
      formatWindowSummary({
        id: "weekly",
        label: "Weekly",
        resetsAt: inMs(86_400_000),
      }),
    ).toBe("Weekly — · 1d");
  });

  it("returns null when the window reports nothing", () => {
    expect(formatWindowSummary({ id: "weekly", label: "Weekly" })).toBeNull();
  });
});

describe("summarizeProviderUsage", () => {
  const providers = [
    usage({
      windows: [
        {
          id: "five_hour",
          label: "Session",
          usedPct: 42,
          resetsAt: inMs(3 * 3_600_000),
        },
        {
          id: "weekly",
          label: "Weekly",
          usedPct: 18,
          resetsAt: inMs(4 * 86_400_000),
        },
        { id: "extra", label: "Extra", usedPct: 5 },
      ],
    }),
  ];

  it("joins the first two reported windows", () => {
    expect(summarizeProviderUsage(providers, "claude")).toBe(
      "Session 42% · 3h  ·  Weekly 18% · 4d",
    );
  });

  it("returns null for an unknown provider, absent data, or no usable window", () => {
    expect(summarizeProviderUsage(providers, "codex")).toBeNull();
    expect(summarizeProviderUsage(undefined, "claude")).toBeNull();
    expect(summarizeProviderUsage([usage()], "claude")).toBeNull();
  });
});
