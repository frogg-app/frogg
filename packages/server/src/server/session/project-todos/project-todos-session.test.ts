import { SessionOutboundMessageSchema } from "@frogg/protocol/messages";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionOutboundMessage } from "../../messages.js";
import { createTodoFixture } from "../../project-todos/test-utils/fixture.js";
import { ProjectTodosSession } from "./project-todos-session.js";

describe("ProjectTodosSession", () => {
  let fixture: Awaited<ReturnType<typeof createTodoFixture>>;
  let messages: SessionOutboundMessage[];
  let session: ProjectTodosSession;

  beforeEach(async () => {
    fixture = await createTodoFixture();
    messages = [];
    session = new ProjectTodosSession({
      service: fixture.service,
      emit: (message) => messages.push(message),
    });
  });

  afterEach(async () => {
    session.close();
    await fixture.cleanup();
  });

  const send = async (msg: Parameters<ProjectTodosSession["dispatch"]>[0]) => {
    await session.dispatch(msg);
    const last = messages.at(-1)!;
    // Every frame must satisfy the wire schema the client validates against.
    expect(SessionOutboundMessageSchema.safeParse(last).success).toBe(true);
    return last;
  };

  it("runs the client lifecycle and emits schema-valid responses", async () => {
    const created = await send({
      type: "project.todo.create.request",
      requestId: "c",
      projectId: "p1",
      title: "Build board",
      category: "ui",
      plan: "# Plan",
    });
    expect(created).toMatchObject({
      type: "project.todo.create.response",
      payload: { item: { id: "t1", plan: "# Plan" }, error: null },
    });

    await send({
      type: "project.todo.update.request",
      requestId: "u",
      projectId: "p1",
      todoId: "t1",
      priority: "urgent",
    });
    await send({
      type: "project.todo.update_plan.request",
      requestId: "up",
      projectId: "p1",
      todoId: "t1",
      plan: "v2",
    });
    const status = await send({
      type: "project.todo.set_status.request",
      requestId: "s",
      projectId: "p1",
      todoId: "t1",
      status: "review",
    });
    expect(status).toMatchObject({
      payload: { item: { status: "review", priority: "urgent", plan: "v2" } },
    });

    const listed = await send({
      type: "project.todo.list.request",
      requestId: "l",
      projectId: "p1",
      statuses: ["review"],
    });
    expect(listed).toMatchObject({
      payload: { categories: ["ui"], items: [{ id: "t1" }] },
    });

    const deleted = await send({
      type: "project.todo.delete.request",
      requestId: "d",
      projectId: "p1",
      todoId: "t1",
    });
    expect(deleted).toMatchObject({ payload: { deleted: true, error: null } });
  });

  it("force-releases every claim for a user", async () => {
    await fixture.service.create("p1", { title: "a", allowParallel: true });
    for (const agentId of ["a1", "a2"]) {
      await fixture.service.claim("p1", "t1", {
        agentId,
        sessionId: null,
        workspaceId: "wt",
        branch: null,
      });
    }
    const released = await send({
      type: "project.todo.release.request",
      requestId: "r",
      projectId: "p1",
      todoId: "t1",
    });
    expect(released).toMatchObject({
      payload: { item: { claims: [], status: "ready" } },
    });
  });

  it("returns structured errors in the payload", async () => {
    const missing = await send({
      type: "project.todo.get.request",
      requestId: "g",
      projectId: "p1",
      todoId: "nope",
    });
    expect(missing).toMatchObject({
      payload: { item: null, error: { code: "todo_not_found" } },
    });
    const project = await send({
      type: "project.todo.list.request",
      requestId: "l",
      projectId: "missing",
    });
    expect(project).toMatchObject({
      payload: { error: { code: "project_not_found" } },
    });
  });

  it("pushes changes for subscribed projects until unsubscribed", async () => {
    await send({
      type: "project.todo.list.request",
      requestId: "l",
      projectId: "p1",
      subscribe: true,
    });
    await fixture.service.create("p1", { title: "pushed" });
    const changed = messages.filter((m) => m.type === "project.todo.changed");
    expect(changed).toEqual([
      {
        type: "project.todo.changed",
        payload: expect.objectContaining({ kind: "upsert", projectId: "p1" }),
      },
    ]);
    expect(SessionOutboundMessageSchema.safeParse(changed[0]).success).toBe(true);

    await send({
      type: "project.todo.unsubscribe.request",
      requestId: "x",
      projectId: "p1",
    });
    await fixture.service.create("p1", { title: "silent" });
    expect(messages.filter((m) => m.type === "project.todo.changed")).toHaveLength(1);
  });
});
