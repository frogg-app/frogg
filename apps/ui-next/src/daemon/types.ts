import type {
  AgentSnapshotPayload,
  AgentTimelineEntryPayloadSchema,
  ProjectPlacementPayloadSchema,
} from "@frogg/protocol/messages";
import type { z } from "zod";

export type Agent = AgentSnapshotPayload;
export type Placement = z.infer<typeof ProjectPlacementPayloadSchema>;
export type TimelineEntry = z.infer<typeof AgentTimelineEntryPayloadSchema>;
export type TimelineItem = TimelineEntry["item"];

export interface Session {
  agent: Agent;
  project: Placement | null;
}

/** The status groups the session list sorts into, in display order. */
export type Bucket = "needs" | "failed" | "review" | "working" | "idle";

export function bucketOf(agent: Agent): Bucket {
  if (agent.pendingPermissions.length > 0 || agent.attentionReason === "permission") return "needs";
  if (agent.status === "error" || agent.attentionReason === "error") return "failed";
  if (agent.status === "running" || agent.status === "initializing") return "working";
  if (agent.requiresAttention && agent.attentionReason === "finished") return "review";
  return "idle";
}
