import { describe, expect, it, vi } from "vitest";
import type { CiRunWatcher } from "../../../services/ci/ci-run-watcher.js";
import type { SessionOutboundMessage } from "../../messages.js";
import { CiRunsSession } from "./ci-runs-session.js";

function fakeWatcher() {
  const listeners = new Map<string, (runs: never[]) => void>();
  const stop = vi.fn();
  const watcher = {
    current: vi.fn(() => []),
    watch: vi.fn((cwd: string, fn: (runs: never[]) => void) => {
      listeners.set(cwd, fn);
      return stop;
    }),
  };
  return { watcher: watcher as unknown as CiRunWatcher, raw: watcher, listeners, stop };
}

describe("CiRunsSession", () => {
  it("watches once per cwd, forwards updates and unwatches", async () => {
    const f = fakeWatcher();
    const emitted: SessionOutboundMessage[] = [];
    const session = new CiRunsSession({ watcher: f.watcher, emit: (m) => emitted.push(m) });
    const watch = { type: "checkout.ci.watch_runs.request", cwd: "/repo", requestId: "1" } as const;
    await session.dispatch(watch);
    await session.dispatch({ ...watch, requestId: "2" });
    expect(f.raw.watch).toHaveBeenCalledTimes(1);
    expect(emitted[0]).toMatchObject({
      type: "checkout.ci.watch_runs.response",
      payload: { cwd: "/repo", runs: [], error: null, requestId: "1" },
    });

    f.listeners.get("/repo")?.([]);
    expect(emitted.at(-1)).toMatchObject({
      type: "checkout.ci.watched_runs.update",
      payload: { cwd: "/repo" },
    });

    await session.dispatch({
      type: "checkout.ci.unwatch_runs.request",
      cwd: "/repo",
      requestId: "3",
    });
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(emitted.at(-1)).toMatchObject({
      type: "checkout.ci.unwatch_runs.response",
      payload: { requestId: "3", error: null },
    });
  });

  it("stops every watch on close", async () => {
    const f = fakeWatcher();
    const session = new CiRunsSession({ watcher: f.watcher, emit: () => {} });
    await session.dispatch({ type: "checkout.ci.watch_runs.request", cwd: "/a", requestId: "1" });
    await session.dispatch({ type: "checkout.ci.watch_runs.request", cwd: "/b", requestId: "2" });
    session.close();
    expect(f.stop).toHaveBeenCalledTimes(2);
  });

  it("answers with an error when the daemon has no watcher", async () => {
    const emitted: SessionOutboundMessage[] = [];
    const session = new CiRunsSession({ watcher: null, emit: (m) => emitted.push(m) });
    await session.dispatch({ type: "checkout.ci.watch_runs.request", cwd: "/a", requestId: "1" });
    expect(emitted[0]).toMatchObject({ payload: { error: { code: "UNKNOWN" } } });
  });
});
