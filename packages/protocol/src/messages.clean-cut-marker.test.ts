import { describe, expect, it } from "vitest";
import { AgentTimelineItemPayloadSchema, WSOutboundMessageSchema } from "./messages.js";
import { validateWSOutboundMessage } from "./validation/ws-outbound.js";

function cutItem(cleanCut: Record<string, unknown>) {
  return { type: "compaction", status: "completed", trigger: "manual", cleanCut };
}

function streamFrame(item: unknown) {
  return {
    type: "session",
    message: {
      type: "agent_stream",
      payload: {
        agentId: "agent-1",
        event: { type: "timeline", provider: "codex", item },
        timestamp: "2026-10-18T00:00:00.000Z",
      },
    },
  };
}

describe("clean cut marker", () => {
  const switched = {
    summary: "the summary",
    previousProvider: "claude",
    previousModel: "opus",
    provider: "codex",
    model: "gpt-5",
    previousContextTokens: 90_000,
    reusedSummary: true,
    reason: "manual",
  };

  it("keeps the provider move and reused-summary state", () => {
    const parsed = AgentTimelineItemPayloadSchema.parse(cutItem(switched));
    expect(parsed).toMatchObject({ cleanCut: switched });
  });

  it("passes the ahead-of-time outbound validator the client uses", () => {
    const frame = streamFrame(cutItem(switched));
    expect(WSOutboundMessageSchema.safeParse(frame).success).toBe(true);
    expect(validateWSOutboundMessage(frame).success).toBe(true);
  });

  it("parses a marker from an older daemon without the newer fields", () => {
    const parsed = AgentTimelineItemPayloadSchema.parse(cutItem({ summary: "s" }));
    expect(parsed).toEqual(cutItem({ summary: "s" }));
  });

  // Older clients rely on unknown marker fields being dropped rather than rejected, which is
  // how a client from before `reusedSummary` still renders this daemon's cuts.
  it("strips marker fields it does not know instead of rejecting the item", () => {
    const parsed = AgentTimelineItemPayloadSchema.parse(cutItem({ ...switched, futureField: 1 }));
    expect(parsed).toMatchObject({ cleanCut: switched });
    expect((parsed as { cleanCut: object }).cleanCut).not.toHaveProperty("futureField");
  });
});
