import { describe, expect, test } from "vitest";

import {
  bugReportEndpoint,
  checkUsageStatsBatch,
  usageEventTime,
  usageStatsEndpoint,
  type UsageStatsBatch,
} from "./events.js";

const batch = (events: unknown[]): unknown => ({
  schema: 1,
  installId: "0b6f3c1e-7f2a-4c55-9a31-2b8e7d1f0c42",
  source: "app",
  client: { product: "frogg-next", version: "1.7.0-beta.3", os: "linux", platform: "desktop" },
  sentAt: "2026-11-02T10:00:00.000Z",
  events,
});

describe("usage statistics batches", () => {
  test("accept allowlisted events", () => {
    const ok = checkUsageStatsBatch(
      batch([
        { name: "app_opened", at: "2026-11-02T10:00:00.000Z", props: {} },
        { name: "session_started", at: "2026-11-02T10:01:00.000Z", props: { provider: "claude" } },
      ]),
    ) as UsageStatsBatch;
    expect(ok.events).toHaveLength(2);
  });

  test.each([
    ["an unknown event", { name: "prompt_sent", at: "2026-11-02T10:00:00.000Z", props: {} }],
    [
      "free text in a property",
      {
        name: "panel_opened",
        at: "2026-11-02T10:00:00.000Z",
        props: { panel: "Fix the login bug" },
      },
    ],
    [
      "a path in a property",
      { name: "panel_opened", at: "2026-11-02T10:00:00.000Z", props: { panel: "/home/a/x" } },
    ],
    [
      "an extra property",
      { name: "app_opened", at: "2026-11-02T10:00:00.000Z", props: { cwd: "x" } },
    ],
  ])("reject %s", (_label, ev) => {
    expect(checkUsageStatsBatch(batch([ev]))).toBeNull();
  });

  test("endpoints are off without a collector", () => {
    expect(usageStatsEndpoint(null)).toBeNull();
    expect(usageStatsEndpoint("  ")).toBeNull();
    expect(usageStatsEndpoint("https://c.example.com/")).toBe("https://c.example.com/v1/events");
    expect(bugReportEndpoint("https://c.example.com")).toBe("https://c.example.com/v1/bug-reports");
  });

  test("event times are minute precision", () => {
    expect(usageEventTime(new Date("2026-11-02T10:11:12.345Z"))).toBe("2026-11-02T10:11:00.000Z");
  });
});
