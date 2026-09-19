import type { Agent } from "@/stores/session-store";

export interface ResolveDetachSubagentDialogInput {
  title: Agent["title"] | null | undefined;
}

/**
 * The subagent's display name, or `null` when it has none worth showing.
 *
 * Detaching loses nothing: the agent keeps its history and simply continues on its own, so it is
 * no longer confirmed. It happens, and this label is what the toast names afterwards.
 */
export function resolveDetachedSubagentLabel(
  input: ResolveDetachSubagentDialogInput,
): string | null {
  const title = input.title;
  if (typeof title !== "string") {
    return null;
  }
  const normalized = title.trim();
  if (!normalized) {
    return null;
  }
  if (normalized.toLowerCase() === "new agent") {
    return null;
  }
  return normalized;
}

export interface DetachSubagentDeps {
  getSubagent: (subagentId: string) => ResolveDetachSubagentDialogInput | undefined;
  detachAgent: (input: { serverId: string; agentId: string }) => Promise<void>;
  openDetachedAgent: (input: { serverId: string; agentId: string }) => void;
  reportDetached: (label: string | null) => void;
  reportError: (error: unknown) => void;
}

export interface RequestDetachSubagentInput {
  serverId: string;
  subagentId: string;
}

export async function requestDetachSubagent(
  input: RequestDetachSubagentInput,
  deps: DetachSubagentDeps,
): Promise<void> {
  const subagent = deps.getSubagent(input.subagentId);
  try {
    await deps.detachAgent({ serverId: input.serverId, agentId: input.subagentId });
    deps.openDetachedAgent({ serverId: input.serverId, agentId: input.subagentId });
    deps.reportDetached(resolveDetachedSubagentLabel({ title: subagent?.title }));
  } catch (error) {
    deps.reportError(error);
  }
}
