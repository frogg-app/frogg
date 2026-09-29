import { describe, expect, it } from "vitest";
import type { ProjectTodoSummary } from "@frogg/protocol/todos/schemas";
import {
  applyProjectTodoChange,
  groupProjectTodos,
  matchesStatusFilter,
  normalizeProjectTodoForm,
  type ProjectTodoListState,
} from "./model";

function todo(overrides: Partial<ProjectTodoSummary> & { id: string }): ProjectTodoSummary {
  return {
    title: overrides.id,
    description: "",
    category: null,
    priority: "medium",
    status: "ready",
    allowParallel: false,
    claims: [],
    progressCount: 0,
    lastProgress: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    planUpdatedAt: null,
    ...overrides,
  };
}

const base: ProjectTodoListState = {
  items: [todo({ id: "a", category: "ui" })],
  categories: ["ui"],
};

describe("applyProjectTodoChange", () => {
  it("ignores events for another project", () => {
    const next = applyProjectTodoChange(base, "p1", {
      kind: "remove",
      projectId: "p2",
      todoId: "a",
    });
    expect(next).toBe(base);
  });

  it("inserts new items and adds their category", () => {
    const next = applyProjectTodoChange(base, "p1", {
      kind: "upsert",
      projectId: "p1",
      item: todo({ id: "b", category: "api" }),
    });
    expect(next.items.map((item) => item.id)).toEqual(["a", "b"]);
    expect(next.categories).toEqual(["api", "ui"]);
  });

  it("replaces existing items in place", () => {
    const next = applyProjectTodoChange(base, "p1", {
      kind: "upsert",
      projectId: "p1",
      item: todo({ id: "a", category: "ui", status: "done" }),
    });
    expect(next.items).toHaveLength(1);
    expect(next.items[0].status).toBe("done");
  });

  it("removes items and is a no-op for unknown ids", () => {
    expect(
      applyProjectTodoChange(base, "p1", { kind: "remove", projectId: "p1", todoId: "a" }).items,
    ).toEqual([]);
    const same = applyProjectTodoChange(base, "p1", {
      kind: "remove",
      projectId: "p1",
      todoId: "zzz",
    });
    expect(same).toBe(base);
  });
});

describe("groupProjectTodos", () => {
  const items = [
    todo({ id: "low", category: "ui", priority: "low" }),
    todo({ id: "urgent", category: "ui", priority: "urgent" }),
    todo({ id: "none", category: null }),
    todo({ id: "api", category: "api", status: "done" }),
  ];

  it("groups by category with uncategorised last and sorts by priority", () => {
    const groups = groupProjectTodos(items, "all");
    expect(groups.map((group) => group.category)).toEqual(["api", "ui", null]);
    expect(groups[1].items.map((item) => item.id)).toEqual(["urgent", "low"]);
  });

  it("drops done items from the open view and empty groups with them", () => {
    const groups = groupProjectTodos(items, "open");
    expect(groups.map((group) => group.category)).toEqual(["ui", null]);
  });

  it("filters to one status", () => {
    const [group] = groupProjectTodos(items, "done");
    expect(group.items.map((item) => item.id)).toEqual(["api"]);
  });
});

describe("matchesStatusFilter", () => {
  it("treats open as everything but done", () => {
    expect(matchesStatusFilter("blocked", "open")).toBe(true);
    expect(matchesStatusFilter("done", "open")).toBe(false);
    expect(matchesStatusFilter("done", "all")).toBe(true);
  });
});

describe("normalizeProjectTodoForm", () => {
  it("rejects blank titles and clears empty categories", () => {
    expect(
      normalizeProjectTodoForm({
        title: "  ",
        description: "",
        category: "",
        priority: "low",
        allowParallel: false,
      }),
    ).toBeNull();
    expect(
      normalizeProjectTodoForm({
        title: " Ship ",
        description: " d ",
        category: "  ",
        priority: "high",
        allowParallel: true,
      }),
    ).toEqual({
      title: "Ship",
      description: "d",
      category: null,
      priority: "high",
      allowParallel: true,
    });
  });
});
