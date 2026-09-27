import { describe, expect, it } from "vitest";
import { groupByDay, mostUrgentStatus, type SoftRecent } from "./soft-data";

function recent(key: string, sortTime: number): SoftRecent {
  return {
    key,
    serverId: "srv",
    workspaceId: key,
    title: key,
    projectName: null,
    projectKey: "srv:p",
    branch: null,
    status: "done",
    diffStat: null,
    sortTime,
  };
}

describe("mostUrgentStatus", () => {
  it("puts work that needs the user ahead of work still running", () => {
    expect(mostUrgentStatus(["done", "running", "needs_input"])).toBe("needs_input");
    expect(mostUrgentStatus(["done", "attention", "running"])).toBe("running");
  });

  it("is done when nothing is live", () => {
    expect(mostUrgentStatus([])).toBe("done");
  });
});

describe("groupByDay", () => {
  const now = new Date(2026, 8, 27, 15, 0, 0);
  const at = (days: number, hour = 12) => new Date(2026, 8, 27 - days, hour).getTime();

  it("buckets by local calendar day and keeps order within a bucket", () => {
    const groups = groupByDay(
      [recent("a", at(0, 14)), recent("b", at(0, 1)), recent("c", at(1)), recent("d", at(3)), recent("e", at(30))],
      now,
    );
    expect(groups.map((group) => [group.key, group.items.map((item) => item.key)])).toEqual([
      ["today", ["a", "b"]],
      ["yesterday", ["c"]],
      ["previous7Days", ["d"]],
      ["older", ["e"]],
    ]);
  });

  it("drops empty buckets", () => {
    expect(groupByDay([recent("x", at(2))], now).map((group) => group.key)).toEqual([
      "previous7Days",
    ]);
  });
});
