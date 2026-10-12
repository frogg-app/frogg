import { describe, expect, it } from "vitest";
import {
  decodeTimelineCursor,
  encodeTimelineCursor,
  projectPermissionRequest,
  projectTimelineItem,
} from "./timeline-projection.js";

describe("timeline projection", () => {
  it("drops reasoning and summarizes tool calls", () => {
    expect(projectTimelineItem({ type: "reasoning", text: "secret" })).toBeNull();
    expect(
      projectTimelineItem({
        type: "tool_call",
        callId: "c1",
        name: "Bash",
        status: "completed",
        error: null,
        detail: { type: "shell", command: "npm   test\n --watch" },
      }),
    ).toEqual({
      type: "tool_call",
      callId: "c1",
      name: "Bash",
      status: "completed",
      summary: "npm test --watch",
    });
  });

  it("turns plan tool calls into plan items", () => {
    expect(
      projectTimelineItem({
        type: "tool_call",
        callId: "c2",
        name: "ExitPlanMode",
        status: "running",
        error: null,
        detail: { type: "plan", text: "1. do it" },
      }),
    ).toEqual({ type: "plan", text: "1. do it" });
  });

  it("round-trips cursors and rejects junk", () => {
    const cursor = { epoch: "ep:with:colons", seq: 42 };
    expect(decodeTimelineCursor(encodeTimelineCursor(cursor))).toEqual(cursor);
    expect(decodeTimelineCursor("nope")).toBeNull();
    expect(decodeTimelineCursor("e:-1")).toBeNull();
    expect(decodeTimelineCursor(null)).toBeNull();
  });

  it("previews permission input and flags always", () => {
    expect(
      projectPermissionRequest("a1", {
        id: "r1",
        provider: "claude",
        name: "Bash",
        kind: "tool",
        detail: { type: "shell", command: "rm -rf build" },
        suggestions: [{ rule: "Bash(rm:*)" }],
      }),
    ).toEqual({
      agentId: "a1",
      requestId: "r1",
      name: "Bash",
      kind: "tool",
      inputPreview: "rm -rf build",
      canAlways: true,
    });
  });
});
