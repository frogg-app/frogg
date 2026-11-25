import { describe, expect, it } from "vitest";
import type { Session } from "../../daemon/types";
import { splitByHost } from "./hostSections";

const sess = (id: string, host?: string) => ({ hostId: host, agent: { id } }) as unknown as Session;
const names: Record<string, string> = { a: "alpha", b: "bravo", z: "zulu" };
const nameOf = (id: string) => names[id] ?? "host";

describe("splitByHost", () => {
  it("puts host sections outermost with the grouping nested, active host first", () => {
    const groups = [
      { key: "needs", label: "Needs you", list: [sess("1", "z"), sess("2")] },
      { key: "idle", label: "Idle", list: [sess("3", "b"), sess("4"), sess("5", "z")] },
    ];
    const out = splitByHost(groups, "a", nameOf);
    expect(out.map((s) => [s.name, s.count])).toEqual([
      ["alpha", 2],
      ["bravo", 1],
      ["zulu", 2],
    ]);
    const ids = (list: Session[]) => list.map((x) => x.agent.id);
    expect(out[0].groups.map((g) => [g.label, ids(g.list)])).toEqual([
      ["Needs you", ["2"]],
      ["Idle", ["4"]],
    ]);
    expect(out[2].groups.map((g) => g.key)).toEqual(["z|needs", "z|idle"]);
  });

  it("keeps a parent's subagent rows directly under it", () => {
    const list = [sess("q"), sess("p", "b"), sess("c1", "b"), sess("c2", "b"), sess("r")];
    const out = splitByHost([{ key: "g", list }], "a", nameOf);
    expect(out.find((s) => s.key === "b")?.groups[0].list.map((x) => x.agent.id)).toEqual([
      "p",
      "c1",
      "c2",
    ]);
  });
});
