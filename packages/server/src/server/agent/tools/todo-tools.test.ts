import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTodoFixture } from "../../project-todos/test-utils/fixture.js";
import type { AgentManager } from "../agent-manager.js";
import { PROJECT_TODO_TOOL_NAMES, registerTodoTools } from "./todo-tools.js";
import type { FroggToolResult } from "./types.js";

type Handler = (input: unknown) => Promise<FroggToolResult>;

function agentManagerWith(agents: Record<string, { workspaceId?: string; sessionId?: string }>) {
  return {
    getAgent: (id: string) => {
      const agent = agents[id];
      if (!agent) return null;
      return {
        id,
        workspaceId: agent.workspaceId,
        persistence: agent.sessionId ? { sessionId: agent.sessionId } : null,
      };
    },
  } as unknown as Pick<AgentManager, "getAgent">;
}

describe("project to-do MCP tools", () => {
  let fixture: Awaited<ReturnType<typeof createTodoFixture>>;
  const agents = {
    a1: { workspaceId: "wt", sessionId: "s1" },
    a2: { workspaceId: "main", sessionId: "s2" },
  };

  const catalogFor = (callerAgentId?: string) => {
    const tools = new Map<string, Handler>();
    registerTodoTools({
      registerTool: (name, _config, handler) => tools.set(name, (input) => handler(input, {})),
      projectTodos: fixture.service,
      agentManager: agentManagerWith(agents),
      workspaceRegistry: {
        get: async (id) => fixture.workspaces.find((w) => w.workspaceId === id) ?? null,
      },
      callerAgentId,
    });
    return (name: string, input: Record<string, unknown> = {}) => tools.get(name)!(input);
  };

  beforeEach(async () => {
    fixture = await createTodoFixture();
  });

  afterEach(async () => {
    await fixture.cleanup();
  });

  it("registers the full tool set", () => {
    const names: string[] = [];
    registerTodoTools({
      registerTool: (name) => void names.push(name),
      projectTodos: fixture.service,
      agentManager: agentManagerWith({}),
    });
    expect(names).toEqual([...PROJECT_TODO_TOOL_NAMES]);
  });

  it("infers project and claimant identity from the caller context", async () => {
    const call = catalogFor("a1");
    const created = await call("todo_create", {
      title: "Wire it",
      plan: "# Steps",
    });
    expect(created.isError).toBeUndefined();
    const claimed = await call("todo_claim", { todoId: "t1" });
    expect(claimed.structuredContent).toMatchObject({
      item: {
        status: "claimed",
        claims: [
          {
            agentId: "a1",
            sessionId: "s1",
            workspaceId: "wt",
            branch: "feature",
          },
        ],
      },
    });
    await call("todo_progress", { todoId: "t1", note: "halfway" });
    const got = await call("todo_get", { todoId: "t1" });
    expect(got.structuredContent).toMatchObject({
      item: { plan: "# Steps", progress: [{ agentId: "a1", note: "halfway" }] },
    });
    const listed = await call("todo_list", { status: ["claimed"] });
    expect(listed.structuredContent).toMatchObject({
      projectId: "p1",
      items: [{ id: "t1" }],
    });
  });

  it("returns a structured claim conflict naming the current claimant", async () => {
    await catalogFor("a1")("todo_create", { title: "Contended" });
    await catalogFor("a1")("todo_claim", { todoId: "t1" });
    const conflict = await catalogFor("a2")("todo_claim", { todoId: "t1" });
    expect(conflict.isError).toBe(true);
    expect(conflict.structuredContent).toEqual({
      error: expect.objectContaining({
        code: "claim_conflict",
        claimants: [
          expect.objectContaining({
            agentId: "a1",
            sessionId: "s1",
            workspaceId: "wt",
          }),
        ],
      }),
    });
  });

  it("releases, updates and completes through the caller's claim", async () => {
    const call = catalogFor("a1");
    await call("todo_create", { title: "x" });
    await call("todo_claim", { todoId: "t1" });
    const released = await call("todo_release", { todoId: "t1" });
    expect(released.structuredContent).toMatchObject({
      item: { claims: [], status: "ready" },
    });
    const notClaimed = await call("todo_release", { todoId: "t1" });
    expect(notClaimed.structuredContent).toMatchObject({
      error: { code: "not_claimed" },
    });
    await call("todo_update", {
      todoId: "t1",
      category: "infra",
      allowParallel: true,
    });
    await call("todo_update_plan", { todoId: "t1", plan: "p" });
    await call("todo_claim", { todoId: "t1" });
    const done = await call("todo_set_status", {
      todoId: "t1",
      status: "done",
      note: "shipped",
    });
    expect(done.structuredContent).toMatchObject({
      item: {
        status: "done",
        claims: [],
        category: "infra",
        allowParallel: true,
        plan: "p",
      },
    });
  });

  it("refuses callers without an agent workspace", async () => {
    const result = await catalogFor(undefined)("todo_list");
    expect(result.structuredContent).toMatchObject({
      error: { code: "invalid_request" },
    });
  });
});
