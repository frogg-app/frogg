import { describe, expect, it } from "vitest";
import { countView, filterRows, groupRows, type InsetRow } from "./inset-data";

function row(key: string, bucket: InsetRow["bucket"]): InsetRow {
  return {
    key,
    serverId: "srv",
    workspaceId: key,
    title: key,
    projectName: "demo",
    bucket,
    branch: null,
    diffStat: null,
    at: null,
  };
}

const ROWS = [
  row("a", "done"),
  row("b", "running"),
  row("c", "needs_input"),
  row("d", "attention"),
  row("e", "running"),
];

describe("inset list model", () => {
  it("groups by status in the app's order and drops empty groups", () => {
    const groups = groupRows(ROWS);
    expect(groups.map((group) => [group.bucket, group.rows.length])).toEqual([
      ["needs_input", 1],
      ["attention", 1],
      ["running", 2],
      ["done", 1],
    ]);
  });

  it("narrows to each saved view", () => {
    expect(filterRows(ROWS, "all")).toHaveLength(5);
    expect(filterRows(ROWS, "active").map((r) => r.key)).toEqual(["b", "c", "d", "e"]);
    expect(filterRows(ROWS, "inbox").map((r) => r.key)).toEqual(["c", "d"]);
    expect(filterRows(ROWS, "running").map((r) => r.key)).toEqual(["b", "e"]);
  });

  it("counts a view without building it", () => {
    expect(countView(ROWS, "all")).toBe(5);
    expect(countView(ROWS, "inbox")).toBe(2);
    expect(countView([], "running")).toBe(0);
  });
});
