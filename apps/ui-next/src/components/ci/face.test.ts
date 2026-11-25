import { describe, expect, it } from "vitest";
import { cardFace, hasHiddenActive, visibleRuns } from "./face";
import type { CiRun } from "./model";

const T0 = Date.parse("2026-11-25T10:00:00Z");

function run(over: Partial<CiRun> = {}): CiRun {
  return {
    id: "r1",
    provider: "githubActions",
    pipeline: "Release",
    branch: "main",
    headSha: "b623de07aa11",
    number: 23,
    trigger: "push",
    status: "running",
    progress: null,
    startedAt: new Date(T0).toISOString(),
    completedAt: null,
    url: null,
    jobs: [],
    ...over,
  } as CiRun;
}

const job = (name: string, status: string) =>
  ({
    id: name,
    name,
    status,
    progress: null,
    startedAt: null,
    completedAt: null,
    url: null,
    steps: [],
  }) as unknown as CiRun["jobs"][number];

describe("cardFace", () => {
  it("shows jobs done, elapsed and percent while running", () => {
    const r = run({
      jobs: [job("a", "success"), job("b", "success"), job("c", "running"), job("d", "queued")],
    });
    const f = cardFace(r, T0 + 6 * 60_000);
    expect(f.title).toBe("Release · b623de07");
    expect(f.sub).toBe("2/4 jobs · 6m");
    expect(f.tone).toBe("run");
    expect(f.pct).toBe("50%");
  });
  it("names the failed job and closes the ring", () => {
    const f = cardFace(
      run({ status: "failure", jobs: [job("android", "failure"), job("ios", "success")] }),
    );
    expect(f).toMatchObject({ sub: "android failed", tone: "fail", progress: 1, pct: null });
  });
  it("falls back to the run number without a sha", () => {
    expect(cardFace(run({ headSha: null })).title).toBe("Release · #23");
  });
});

describe("dismissal", () => {
  const live = run({ id: "a" });
  const done = run({ id: "b", status: "success" });
  it("hides dismissed cards", () => {
    expect(visibleRuns([live, done], { a: true }).map((r) => r.id)).toEqual(["b"]);
  });
  it("offers Show only for a dismissed run still going", () => {
    expect(hasHiddenActive([live, done], {})).toBe(false);
    expect(hasHiddenActive([live, done], { b: true })).toBe(false);
    expect(hasHiddenActive([live, done], { a: true })).toBe(true);
  });
});
