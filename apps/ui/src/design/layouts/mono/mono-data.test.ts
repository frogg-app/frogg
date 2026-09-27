import { describe, expect, it } from "vitest";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { shortIdOf, shortPath, toChatRow, turnDurationMs } from "./mono-data";

const T0 = new Date("2026-09-27T10:00:00Z");
const T1 = new Date("2026-09-27T10:02:30Z");

const AGENT: Agent = {
  serverId: "srv",
  id: "9cfec6e9-9075-4525-91ae-4fe43a6ccfe3",
  provider: "claude",
  status: "idle",
  activeTurn: null,
  createdAt: T0,
  updatedAt: T1,
  lastUserMessageAt: T0,
  lastActivityAt: T1,
  capabilities: {
    supportsStreaming: true,
    supportsSessionPersistence: true,
    supportsDynamicModes: true,
    supportsMcpServers: true,
    supportsReasoningStream: true,
    supportsToolInvocations: true,
  },
  currentModeId: null,
  availableModes: [],
  pendingPermissions: [],
  persistence: null,
  lastError: null,
  title: "Refactor loader",
  cwd: "/home/me/code/app",
  workspaceId: "wks_1",
  model: "sonnet",
  requiresAttention: false,
  attentionReason: null,
  archivedAt: null,
  parentAgentId: null,
  labels: {},
};

const WORKSPACE = {
  id: "wks_1",
  projectId: "proj",
  projectDisplayName: "app",
  projectCustomName: null,
  name: "feature/login",
  status: "done",
  gitRuntime: { currentBranch: "feature/login" },
  diffStat: { additions: 3, deletions: 1 },
} as unknown as WorkspaceDescriptor;

describe("mono chat rows", () => {
  it("joins an agent to its workspace's project, branch and diff", () => {
    const row = toChatRow({
      serverId: "srv",
      agent: AGENT,
      workspace: WORKSPACE,
      hostLabel: "laptop",
    });
    expect(row).toMatchObject({
      shortId: "9cfec6e99",
      title: "Refactor loader",
      bucket: "done",
      projectName: "app",
      branch: "feature/login",
      diffStat: { additions: 3, deletions: 1 },
      hostLabel: "laptop",
    });
  });

  it("maps pending permissions to needs input and errors to failed", () => {
    const waiting = { ...AGENT, pendingPermissions: [{}] } as unknown as Agent;
    const failed: Agent = { ...AGENT, status: "error" };
    expect(
      toChatRow({ serverId: "srv", agent: waiting, workspace: undefined, hostLabel: "h" }).bucket,
    ).toBe("needs_input");
    expect(
      toChatRow({ serverId: "srv", agent: failed, workspace: undefined, hostLabel: "h" }).bucket,
    ).toBe("failed");
  });

  it("treats a project-less chat workspace as having no project", () => {
    const chat = { ...WORKSPACE, chat: true } as WorkspaceDescriptor;
    expect(
      toChatRow({ serverId: "srv", agent: AGENT, workspace: chat, hostLabel: "h" }).projectName,
    ).toBeNull();
  });

  it("measures a finished turn from the last message to the last update", () => {
    const row = toChatRow({ serverId: "srv", agent: AGENT, workspace: WORKSPACE, hostLabel: "h" });
    expect(turnDurationMs(row, T1.getTime() + 60_000)).toBe(150_000);
  });

  it("counts a running turn up to now", () => {
    const running: Agent = {
      ...AGENT,
      status: "running",
      activeTurn: { turnId: "t", startedAt: T1 },
    };
    const row = toChatRow({
      serverId: "srv",
      agent: running,
      workspace: WORKSPACE,
      hostLabel: "h",
    });
    expect(turnDurationMs(row, T1.getTime() + 5_000)).toBe(5_000);
  });

  it("shortens ids and paths for table cells", () => {
    expect(shortIdOf("a1f4f33d-fb7c-45e9")).toBe("a1f4f33df");
    expect(shortPath("/home/me/code/app")).toBe("…/code/app");
    expect(shortPath("app")).toBe("app");
  });
});
