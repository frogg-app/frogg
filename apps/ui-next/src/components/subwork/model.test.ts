import { describe, expect, it } from "vitest";
import { fromTimeline, type TimelineSrc } from "./model";

const shell = (callId: string, id: string): TimelineSrc => ({
  timestamp: "2026-01-01T00:00:00Z",
  item: {
    type: "tool_call",
    callId,
    status: "completed",
    detail: {
      type: "shell",
      command: "sleep 5",
      output: `Command running in background with ID: ${id}. Output is being written to: /tmp/x`,
    },
  },
});
const note = (callId: string, metadata?: TimelineSrc["item"]["metadata"]): TimelineSrc => ({
  timestamp: "2026-01-01T00:00:05Z",
  item: { type: "tool_call", callId, status: "completed", metadata },
});
const t0 = Date.parse("2026-01-01T00:00:01Z");

describe("fromTimeline background commands", () => {
  it("settles on a Claude notification that carries the task id in metadata", () => {
    const n = note("task_notification_e0c91805", { taskId: "b8ptp1nge", status: "completed" });
    const [bg] = fromTimeline("p", [shell("c3", "b8ptp1nge"), n], t0);
    expect(bg.status).toBe("done");
    expect(bg.endedAt).toBe(Date.parse("2026-01-01T00:00:05Z"));
  });

  it("reads a killed status from metadata as failed", () => {
    const n = note("task_notification_x", { taskId: "b8ptp1nge", status: "killed" });
    expect(fromTimeline("p", [shell("c3", "b8ptp1nge"), n], t0)[0].status).toBe("failed");
  });

  it("still matches the older shape with the task id in the call id", () => {
    const n = note("task_notification_bgabc123");
    expect(fromTimeline("p", [shell("c1", "bgabc123"), n], t0)[0].status).toBe("done");
  });

  it("stays running when no notification matches", () => {
    const n = note("task_notification_x", { taskId: "other1" });
    expect(fromTimeline("p", [shell("c1", "b8ptp1nge"), n], t0)[0].status).toBe("running");
  });
});
