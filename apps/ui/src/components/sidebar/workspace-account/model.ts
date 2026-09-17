import type { SidebarAgentNode } from "@/components/sidebar/agents/model";

/**
 * COMPAT(perAgentProviderAccounts): added in v1.4.0, remove after 2027-09-17.
 *
 * Which agent a workspace row reports an account for. A row is one line for a whole
 * workspace, so with several agents it can only name one of them: the newest wins, because
 * `buildSidebarAgentTrees` sorts roots by creation time and the newest is the one the row's
 * title and status are already describing.
 */
export interface WorkspaceAccountAgent {
  agentId: string;
  provider: string;
  /** Three-valued like the composer pill: see `ProviderAccountSelection`. */
  providerAccountId: string | null | undefined;
}

export function resolveWorkspaceAccountAgent(
  roots: readonly SidebarAgentNode[],
): WorkspaceAccountAgent | null {
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const node = roots[index];
    // Provider-reported subagents are not Frogg agents and carry no account of their own.
    if (node.row.kind !== "frogg") continue;
    return {
      agentId: node.row.id,
      provider: node.row.provider,
      providerAccountId: node.providerAccountId,
    };
  }
  return null;
}
