import { beforeEach, describe, expect, it } from "vitest";
import { useSubWorkStore } from "../../daemon/subwork";
import { useTodos, type Todo } from "../../daemon/todos";
import { useUi } from "../../ui-store";
import { openSubWork } from "./hooks";
import type { SubWork } from "./model";

const item = (over: Partial<SubWork>): SubWork => ({
  id: "sub:a1",
  kind: "subagent",
  label: "Explore",
  status: "running",
  startedAt: null,
  parentId: "p",
  ...over,
});

const todo = (agentId: string) =>
  ({ id: "t1", title: "Cache cap", claims: [{ agentId, stale: false }] }) as unknown as Todo;

describe("openSubWork", () => {
  beforeEach(() => {
    useUi.setState({ tool: "sessions", selected: "other", terminalId: null });
    useSubWorkStore.setState({ detail: {} });
    useTodos.setState({ items: {}, open: null });
  });

  it("opens a subagent with no to-do as its details in the parent's chat, not Tasks", () => {
    openSubWork("p", item({}));
    expect(useUi.getState().tool).toBe("sessions");
    expect(useUi.getState().selected).toBe("p");
    expect(useSubWorkStore.getState().detail).toEqual({ p: "sub:a1" });
  });

  it("opens Tasks on the to-do when the subagent claimed one", () => {
    useTodos.setState({ items: { proj: [todo("a1")] } });
    openSubWork("p", item({}));
    expect(useUi.getState().tool).toBe("tasks");
    expect(useTodos.getState().open).toEqual({ projectId: "proj", todoId: "t1" });
    expect(useSubWorkStore.getState().detail).toEqual({});
  });

  it("ignores to-dos claimed by other agents", () => {
    useTodos.setState({ items: { proj: [todo("someone-else")] } });
    openSubWork("p", item({}));
    expect(useUi.getState().tool).toBe("sessions");
  });

  it("opens a child session as itself and a terminal in Terminals", () => {
    openSubWork("p", item({ id: "child:c", kind: "child-session", openId: "c" }));
    expect(useUi.getState().selected).toBe("c");
    openSubWork("p", item({ id: "term:t", kind: "terminal", openId: "t" }));
    expect(useUi.getState().tool).toBe("terminals");
    expect(useUi.getState().terminalId).toBe("t");
  });

  it("drops a parent's details when another session is selected", () => {
    openSubWork("p", item({}));
    useUi.getState().select("q");
    expect(useSubWorkStore.getState().detail).toEqual({});
  });
});
