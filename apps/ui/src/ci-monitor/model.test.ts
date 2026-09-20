import { describe, expect, it } from "vitest";
import { filterCiRunsByBranch, type CiRun } from "./model";

function run(id: string, branch: string | null): CiRun {
  return {
    id,
    provider: "githubActions",
    pipeline: "CI",
    branch,
    number: 1,
    trigger: "push",
    status: "success",
    progress: 1,
    startedAt: null,
    completedAt: null,
    url: null,
    jobs: [],
  };
}

describe("filterCiRunsByBranch", () => {
  it("keeps every branch's runs when no branch is given, which is the pane's default", () => {
    const runs = [run("a", "main"), run("b", "feature/x")];
    expect(filterCiRunsByBranch(runs, null)).toEqual(runs);
  });

  it("narrows to one branch when the filter is on", () => {
    const runs = [run("a", "main"), run("b", "feature/x")];
    expect(filterCiRunsByBranch(runs, "main").map((entry) => entry.id)).toEqual(["a"]);
  });

  it("keeps runs whose branch the daemon did not report rather than hiding them", () => {
    const runs = [run("a", null), run("b", "feature/x")];
    expect(filterCiRunsByBranch(runs, "main").map((entry) => entry.id)).toEqual(["a"]);
  });
});
