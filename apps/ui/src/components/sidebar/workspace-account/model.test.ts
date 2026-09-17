import { describe, expect, it } from "vitest";
import type { SidebarAgentNode } from "@/components/sidebar/agents/model";
import { resolveWorkspaceAccountAgent } from "./model";

function froggNode(input: {
  id: string;
  provider?: string;
  providerAccountId?: string | null;
}): SidebarAgentNode {
  return {
    key: `s\0agent\0${input.id}`,
    serverId: "s",
    workspaceId: "w",
    row: {
      kind: "frogg",
      id: input.id,
      provider: input.provider ?? "claude",
      title: input.id,
      description: null,
      subtitle: null,
      status: "idle",
      requiresAttention: false,
      createdAt: new Date("2026-09-17T00:00:00.000Z"),
    },
    target: { kind: "agent", agentId: input.id },
    providerAccountId: input.providerAccountId,
    children: [],
  };
}

function providerNode(id: string): SidebarAgentNode {
  return {
    key: `s\0provider\0${id}`,
    serverId: "s",
    workspaceId: "w",
    row: {
      kind: "provider",
      id,
      provider: "claude",
      title: id,
      description: null,
      subtitle: null,
      status: "running",
      requiresAttention: false,
      createdAt: new Date("2026-09-17T00:00:00.000Z"),
      parentAgentId: "a1",
    },
    target: { kind: "agent", agentId: "a1" },
    children: [],
  };
}

describe("resolveWorkspaceAccountAgent", () => {
  it("returns null for a workspace with no agents", () => {
    expect(resolveWorkspaceAccountAgent([])).toBeNull();
  });

  it("reports the newest root, which is the one the row's title already describes", () => {
    const resolved = resolveWorkspaceAccountAgent([
      froggNode({ id: "a1", providerAccountId: "work" }),
      froggNode({ id: "a2", providerAccountId: "personal" }),
    ]);
    expect(resolved).toEqual({
      agentId: "a2",
      provider: "claude",
      providerAccountId: "personal",
    });
  });

  it("keeps an absent account absent so the caller resolves it like the daemon does", () => {
    expect(resolveWorkspaceAccountAgent([froggNode({ id: "a1" })])).toEqual({
      agentId: "a1",
      provider: "claude",
      providerAccountId: undefined,
    });
  });

  it("skips provider-reported subagents, which have no account of their own", () => {
    const resolved = resolveWorkspaceAccountAgent([
      froggNode({ id: "a1", providerAccountId: "work" }),
      providerNode("sub-1"),
    ]);
    expect(resolved?.agentId).toBe("a1");
  });
});
