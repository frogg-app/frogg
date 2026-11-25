import { describe, expect, it, vi } from "vitest";
import type { CiRun } from "@frogg/protocol/messages";
import {
  CI_WATCH_ACTIVE_MS,
  CI_WATCH_IDLE_BASE_MS,
  CI_WATCH_IDLE_CAP_MS,
  CI_WATCH_UNAVAILABLE_MS,
  CiRunWatcher,
  nextPollDelay,
  selectWatchedRuns,
} from "./ci-run-watcher.js";

const NOW = Date.parse("2026-11-25T10:00:00Z");

function run(id: string, over: Partial<CiRun> = {}): CiRun {
  return {
    id,
    provider: "githubActions",
    pipeline: "CI",
    branch: "main",
    headSha: "abc",
    number: 1,
    trigger: "push",
    status: "running",
    progress: null,
    startedAt: new Date(NOW - 60_000).toISOString(),
    completedAt: null,
    url: null,
    jobs: [],
    ...over,
  } as CiRun;
}

function harness(
  listRuns: () => Promise<CiRun[]>,
  scope: unknown = { api: vi.fn(), shas: ["abc"] },
) {
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const watcher = new CiRunWatcher({
    resolveScope: async () => scope as never,
    listRuns: listRuns as never,
    now: () => NOW,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      (t as { cleared: boolean }).cleared = true;
    },
  });
  return { watcher, timers };
}

describe("selectWatchedRuns", () => {
  it("keeps active and recently finished runs, newest first", () => {
    const old = run("old", {
      status: "success",
      completedAt: new Date(NOW - 10 * 60_000).toISOString(),
    });
    const recent = run("recent", {
      status: "failure",
      startedAt: new Date(NOW - 30_000).toISOString(),
      completedAt: new Date(NOW - 10_000).toISOString(),
    });
    const live = run("live");
    expect(selectWatchedRuns([old, live, recent, live], NOW).map((r) => r.id)).toEqual([
      "recent",
      "live",
    ]);
  });
});

describe("nextPollDelay", () => {
  it("polls fast while active and backs off when idle", () => {
    expect(nextPollDelay(true, 5)).toBe(CI_WATCH_ACTIVE_MS);
    expect(nextPollDelay(false, 1)).toBe(CI_WATCH_IDLE_BASE_MS);
    expect(nextPollDelay(false, 2)).toBe(CI_WATCH_IDLE_BASE_MS * 2);
    expect(nextPollDelay(false, 50)).toBe(CI_WATCH_IDLE_CAP_MS);
  });
});

describe("CiRunWatcher", () => {
  it("shares one poll per cwd and only notifies on change", async () => {
    const listRuns = vi.fn(async () => [run("a")]);
    const { watcher, timers } = harness(listRuns);
    const a = vi.fn();
    const b = vi.fn();
    watcher.watch("/repo", a);
    watcher.watch("/repo", b);
    await watcher.settle();
    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith([expect.objectContaining({ id: "a" })]);
    expect(watcher.current("/repo")).toHaveLength(1);
    expect(timers.at(-1)?.ms).toBe(CI_WATCH_ACTIVE_MS);

    timers.at(-1)?.fn();
    await watcher.settle();
    expect(listRuns).toHaveBeenCalledTimes(2);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the last listener leaves", async () => {
    const { watcher, timers } = harness(async () => [run("a")]);
    const stopA = watcher.watch("/repo", () => {});
    const stopB = watcher.watch("/repo", () => {});
    await watcher.settle();
    stopA();
    expect(timers.at(-1)?.cleared).toBe(false);
    stopB();
    expect(timers.at(-1)?.cleared).toBe(true);
    expect(watcher.current("/repo")).toEqual([]);
  });

  it("publishes nothing and retries rarely when there is no scope", async () => {
    const { watcher, timers } = harness(async () => [], null);
    const listener = vi.fn();
    watcher.watch("/repo", listener);
    await watcher.settle();
    expect(listener).not.toHaveBeenCalled();
    expect(timers.at(-1)?.ms).toBe(CI_WATCH_UNAVAILABLE_MS);
  });

  it("keeps the last set when a poll fails", async () => {
    let fail = false;
    const { watcher, timers } = harness(async () => {
      if (fail) throw new Error("rate limited");
      return [run("a")];
    });
    watcher.watch("/repo", () => {});
    await watcher.settle();
    fail = true;
    timers.at(-1)?.fn();
    await watcher.settle();
    expect(watcher.current("/repo")).toHaveLength(1);
  });

  it("poke repolls straight away", async () => {
    const listRuns = vi.fn(async () => []);
    const { watcher, timers } = harness(listRuns);
    watcher.watch("/repo", () => {});
    await watcher.settle();
    watcher.poke("/repo");
    await watcher.settle();
    expect(listRuns).toHaveBeenCalledTimes(2);
    expect(timers[0]?.cleared).toBe(true);
  });
});
