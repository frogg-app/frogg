import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectTodoError } from "./operations.js";
import { ProjectTodoService, resolveProjectTodoRoot, type ProjectTodoChange } from "./service.js";
import { createTodoFixture, projectRecord, workspaceRecord } from "./test-utils/fixture.js";

const project = projectRecord;
const workspace = workspaceRecord;

describe("resolveProjectTodoRoot", () => {
  it("resolves a worktree workspace to its main repository root", () => {
    const root = resolveProjectTodoRoot(project({ rootPath: "/repo" }), [
      workspace({
        workspaceId: "wt",
        kind: "worktree",
        cwd: "/worktrees/x",
        worktreeRoot: "/worktrees/x",
        mainRepoRoot: "/repo",
      }),
    ]);
    expect(root).toBe(path.resolve("/repo"));
  });

  it("uses the checkout root for non-worktree checkouts", () => {
    const root = resolveProjectTodoRoot(project({ rootPath: "/repo/sub" }), [
      workspace({ cwd: "/repo/sub", worktreeRoot: "/repo" }),
    ]);
    expect(root).toBe(path.resolve("/repo"));
  });

  it("refuses to resolve into a worktree directory", () => {
    expect(() =>
      resolveProjectTodoRoot(project({ rootPath: "/worktrees/x" }), [
        workspace({
          kind: "worktree",
          cwd: "/worktrees/x",
          worktreeRoot: "/worktrees/x",
        }),
      ]),
    ).toThrow(ProjectTodoError);
  });
});

describe("ProjectTodoService", () => {
  let root: string;
  let running: Set<string>;
  let changes: ProjectTodoChange[];
  let service: ProjectTodoService;

  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const fixture = await createTodoFixture();
    ({ root, running, service, cleanup } = fixture);
    changes = [];
    service.subscribe((change) => changes.push(change));
  });

  afterEach(async () => {
    await cleanup();
  });

  const claimant = (agentId: string) => ({
    agentId,
    sessionId: `s-${agentId}`,
    workspaceId: "wt",
    branch: "feature",
  });

  it("stores the index and plans under the main root with a self-ignoring .gitignore", async () => {
    const created = await service.create("p1", {
      title: " Ship it ",
      category: "infra",
      plan: "# Plan",
    });
    expect(created).toMatchObject({
      id: "t1",
      title: "Ship it",
      status: "backlog",
      plan: "# Plan",
    });
    const dir = path.join(root, ".frogg", "todos");
    expect(await readFile(path.join(dir, ".gitignore"), "utf8")).toContain("*");
    expect(await readFile(path.join(dir, "plans", "t1.md"), "utf8")).toBe("# Plan");
    const index = JSON.parse(await readFile(path.join(dir, "index.json"), "utf8"));
    expect(index.items).toHaveLength(1);
    // Atomic writes leave no temp files behind.
    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    await expect(stat(path.join(`${root}-wt`, ".frogg"))).rejects.toThrow();
  });

  it("serializes concurrent mutations without losing writes", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => service.create("p1", { title: `item ${i}` })),
    );
    const { items } = await service.list("p1");
    expect(items).toHaveLength(10);
  });

  it("filters by status and category and lists used categories", async () => {
    await service.create("p1", { title: "a", category: "ui" });
    await service.create("p1", {
      title: "b",
      category: "infra",
      status: "ready",
    });
    await service.create("p1", { title: "c" });
    const ready = await service.list("p1", { statuses: ["ready"] });
    expect(ready.items.map((i) => i.title)).toEqual(["b"]);
    expect(ready.categories).toEqual(["infra", "ui"]);
    const ui = await service.list("p1", { category: "ui" });
    expect(ui.items.map((i) => i.title)).toEqual(["a"]);
  });

  it("rejects a conflicting claim with the current claimant", async () => {
    await service.create("p1", { title: "a" });
    const claimed = await service.claim("p1", "t1", claimant("a1"));
    expect(claimed.status).toBe("claimed");
    const error = await service.claim("p1", "t1", claimant("a2")).catch((e) => e);
    expect(error).toBeInstanceOf(ProjectTodoError);
    expect(error.code).toBe("claim_conflict");
    expect(error.claimants).toEqual([
      expect.objectContaining({
        agentId: "a1",
        sessionId: "s-a1",
        workspaceId: "wt",
        stale: false,
      }),
    ]);
  });

  it("allows parallel claims when the item permits it", async () => {
    await service.create("p1", { title: "a", allowParallel: true });
    await service.claim("p1", "t1", claimant("a1"));
    const both = await service.claim("p1", "t1", claimant("a2"));
    expect(both.claims.map((c) => c.agentId)).toEqual(["a1", "a2"]);
  });

  it("treats a re-claim by the same agent as a heartbeat refresh", async () => {
    await service.create("p1", { title: "a" });
    const first = await service.claim("p1", "t1", claimant("a1"));
    const second = await service.claim("p1", "t1", claimant("a1"));
    expect(second.claims).toHaveLength(1);
    expect(second.claims[0]!.claimedAt).toBe(first.claims[0]!.claimedAt);
    expect(second.claims[0]!.lastHeartbeat > first.claims[0]!.lastHeartbeat).toBe(true);
  });

  it("reports stale claims without releasing them and allows takeover only of stale claims", async () => {
    await service.create("p1", { title: "a" });
    await service.claim("p1", "t1", claimant("a1"));
    const live = await service
      .claim("p1", "t1", claimant("a2"), { takeover: true })
      .catch((e) => e);
    expect(live.code).toBe("takeover_not_allowed");

    running.delete("a1");
    const detail = await service.get("p1", "t1");
    expect(detail.claims).toEqual([expect.objectContaining({ agentId: "a1", stale: true })]);

    const plain = await service.claim("p1", "t1", claimant("a2")).catch((e) => e);
    expect(plain.code).toBe("claim_conflict");
    const taken = await service.claim("p1", "t1", claimant("a2"), {
      takeover: true,
    });
    expect(taken.claims.map((c) => c.agentId)).toEqual(["a2"]);
    expect(taken.progress.at(-1)?.note).toContain("a1");
  });

  it("releases claims on done, explicit release, and agent archive", async () => {
    await service.create("p1", { title: "a" });
    await service.create("p1", { title: "b" });
    await service.create("p1", { title: "c" });
    await service.claim("p1", "t1", claimant("a1"));
    await service.claim("p1", "t2", claimant("a1"));
    await service.claim("p1", "t3", claimant("a1"));

    const done = await service.setStatus("p1", "t1", "done");
    expect(done.claims).toEqual([]);

    const released = await service.release("p1", "t2", "a1", {
      requireClaim: true,
    });
    expect(released).toMatchObject({ claims: [], status: "ready" });
    await expect(service.release("p1", "t2", "a1", { requireClaim: true })).rejects.toMatchObject({
      code: "not_claimed",
    });

    await service.releaseAgent("a1");
    const archived = await service.get("p1", "t3");
    expect(archived.claims).toEqual([]);
    expect(archived.status).toBe("ready");
  });

  it("appends progress, updates fields and plans, and deletes", async () => {
    await service.create("p1", { title: "a" });
    await service.addProgress("p1", "t1", "step one", "a1");
    const updated = await service.update("p1", "t1", {
      priority: "high",
      category: "  ",
    });
    expect(updated).toMatchObject({
      priority: "high",
      category: null,
      progressCount: 1,
    });
    const planned = await service.updatePlan("p1", "t1", "new plan");
    expect(planned.plan).toBe("new plan");
    expect(planned.planUpdatedAt).not.toBeNull();
    expect(await service.delete("p1", "t1")).toBe(true);
    expect(await service.delete("p1", "t1")).toBe(false);
    expect(changes.at(-1)).toEqual({
      kind: "remove",
      projectId: "p1",
      todoId: "t1",
    });
    await expect(service.get("p1", "t1")).rejects.toMatchObject({
      code: "todo_not_found",
    });
  });

  it("emits an upsert change for every mutation", async () => {
    await service.create("p1", { title: "a" });
    await service.claim("p1", "t1", claimant("a1"));
    expect(changes.map((c) => c.kind)).toEqual(["upsert", "upsert"]);
  });

  it("fails for an unknown project", async () => {
    await expect(service.list("nope")).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
});
