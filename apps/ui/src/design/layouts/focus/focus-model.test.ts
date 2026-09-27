import { describe, expect, it } from "vitest";
import type { Agent, ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import {
  buildFocusChecklist,
  describeFocusStatus,
  formatWorkingDuration,
  resolveProjectBranch,
  selectRecentAgents,
  selectWorkspaceAgents,
} from "./focus-model";

function agent(overrides: Partial<Agent>): Agent {
  return {
    id: "a1",
    status: "idle",
    pendingPermissions: [],
    parentAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    lastActivityAt: new Date(0),
    title: null,
    ...overrides,
  } as Agent;
}

function workspace(overrides: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    id: "w1",
    projectId: "p1",
    workspaceDirectory: "/repo",
    scripts: [],
    diffStat: null,
    ...overrides,
  } as WorkspaceDescriptor;
}

describe("describeFocusStatus", () => {
  it("reports a running agent as working", () => {
    const line = describeFocusStatus(agent({ status: "running" }), null);
    expect(line).toMatchObject({ tone: "running", label: "Working…", unread: false });
  });

  it("puts a pending permission ahead of running", () => {
    const pending = [{}] as Agent["pendingPermissions"];
    const line = describeFocusStatus(
      agent({ status: "running", pendingPermissions: pending }),
      null,
    );
    expect(line).toMatchObject({ tone: "warning", label: "Needs input" });
  });

  it("shows changes ready with the diff and an unread dot after a finished turn", () => {
    const line = describeFocusStatus(
      agent({ requiresAttention: true, attentionReason: "finished" }),
      { additions: 2, deletions: 1 },
    );
    expect(line).toMatchObject({
      tone: "success",
      label: "Changes ready",
      diff: { additions: 2, deletions: 1 },
      unread: true,
    });
  });

  it("falls back to the relative time for a quiet chat with no changes", () => {
    const line = describeFocusStatus(agent({}), { additions: 0, deletions: 0 });
    expect(line).toMatchObject({ tone: "muted", showTime: true, diff: null });
  });

  it("reports errors as failed", () => {
    expect(describeFocusStatus(agent({ status: "error" }), null).tone).toBe("danger");
  });
});

describe("agent selection", () => {
  const older = agent({ id: "old", lastActivityAt: new Date(1), createdAt: new Date(1) });
  const newer = agent({ id: "new", lastActivityAt: new Date(5), createdAt: new Date(2) });
  const child = agent({ id: "child", parentAgentId: "old", lastActivityAt: new Date(9) });
  const archived = agent({ id: "gone", archivedAt: new Date(3), lastActivityAt: new Date(8) });

  it("lists recent top-level chats newest first", () => {
    const ids = selectRecentAgents([older, newer, child, archived], 10).map((a) => a.id);
    expect(ids).toEqual(["new", "old"]);
  });

  it("lists a workspace's agents in creation order", () => {
    const list = [
      { ...newer, workspaceId: "w1" },
      { ...older, workspaceId: "w1" },
      { ...child, workspaceId: "w1" },
      agent({ id: "elsewhere", workspaceId: "w2" }),
    ];
    expect(selectWorkspaceAgents(list, "w1").map((a) => a.id)).toEqual(["old", "new"]);
    expect(selectWorkspaceAgents(list, undefined)).toEqual([]);
  });
});

describe("buildFocusChecklist", () => {
  it("marks each step from host state", () => {
    const steps = buildFocusChecklist({
      hostOnline: true,
      projects: [{ projectId: "c", chats: true } as ProjectDescriptor],
      workspaces: [],
      agentCount: 0,
    });
    expect(steps.map((step) => [step.id, step.done])).toEqual([
      ["host", true],
      ["project", false],
      ["chat", false],
      ["scripts", false],
    ]);
  });

  it("counts scripts only on project workspaces", () => {
    const scripts = [{}] as WorkspaceDescriptor["scripts"];
    const steps = buildFocusChecklist({
      hostOnline: true,
      projects: [{ projectId: "p1" } as ProjectDescriptor],
      workspaces: [workspace({ scripts })],
      agentCount: 2,
    });
    expect(steps.every((step) => step.done)).toBe(true);
  });
});

describe("helpers", () => {
  it("formats working durations", () => {
    const start = new Date(0);
    expect(formatWorkingDuration(start, new Date(15_000))).toBe("15s");
    expect(formatWorkingDuration(start, new Date(4 * 60_000))).toBe("4m");
    expect(formatWorkingDuration(start, new Date(63 * 60_000))).toBe("1h 3m");
  });

  it("prefers the root checkout's branch", () => {
    const project = { projectId: "p1", projectRootPath: "/repo" };
    const branch = resolveProjectBranch(project, [
      workspace({ id: "wt", workspaceDirectory: "/wt", gitRuntime: { currentBranch: "feat" } }),
      workspace({ id: "root", gitRuntime: { currentBranch: "main" } }),
    ]);
    expect(branch).toBe("main");
  });
});
