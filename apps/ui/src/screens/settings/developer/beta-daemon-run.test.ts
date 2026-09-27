import { describe, expect, it } from "vitest";
import type { DaemonBetaChannelRun } from "@frogg/protocol/messages";
import {
  BETA_DAEMON_LOG_LIMIT,
  INITIAL_BETA_DAEMON_RUN_STATE,
  isBetaDaemonRunBusy,
  reduceBetaDaemonRun,
} from "./beta-daemon-run";

function run(runId: string, phase: string): DaemonBetaChannelRun {
  return {
    runId,
    action: "install",
    targetVersion: "1.6.5-beta.3",
    phase,
    message: null,
    startedAt: "2026-09-27T00:00:00Z",
    at: "2026-09-27T00:00:01Z",
  };
}

describe("beta daemon run state", () => {
  it("follows an accepted run through progress to completion", () => {
    let state = reduceBetaDaemonRun(INITIAL_BETA_DAEMON_RUN_STATE, {
      type: "start",
      action: "install",
    });
    expect(isBetaDaemonRunBusy(state.view)).toBe(true);
    state = reduceBetaDaemonRun(state, { type: "accepted", runId: "r1" });
    state = reduceBetaDaemonRun(state, {
      type: "progress",
      run: run("r1", "download"),
      logLine: "fetching",
    });
    expect(state.view).toMatchObject({ kind: "running", run: { phase: "download" } });
    expect(state.log).toEqual(["fetching"]);
    state = reduceBetaDaemonRun(state, {
      type: "completed",
      payload: {
        runId: "r1",
        action: "install",
        status: "succeeded",
        version: "1.6.5-beta.3",
        error: null,
        at: "x",
      },
    });
    expect(state.view).toMatchObject({ kind: "completed", status: "succeeded" });
    expect(isBetaDaemonRunBusy(state.view)).toBe(false);
    expect(state.log).toEqual(["fetching"]);
  });

  it("ignores events for another run while one is in flight", () => {
    let state = reduceBetaDaemonRun(INITIAL_BETA_DAEMON_RUN_STATE, {
      type: "start",
      action: "install",
    });
    state = reduceBetaDaemonRun(state, { type: "accepted", runId: "r1" });
    const next = reduceBetaDaemonRun(state, { type: "progress", run: run("r2", "verify") });
    expect(next).toBe(state);
  });

  it("shows a run started elsewhere when idle", () => {
    const state = reduceBetaDaemonRun(INITIAL_BETA_DAEMON_RUN_STATE, {
      type: "progress",
      run: run("r9", "install"),
      logLine: "hello",
    });
    expect(state.view).toMatchObject({ kind: "running" });
    expect(state.runId).toBe("r9");
  });

  it("surfaces a refused start as an error", () => {
    const state = reduceBetaDaemonRun(INITIAL_BETA_DAEMON_RUN_STATE, {
      type: "rejected",
      message: "owner role required",
    });
    expect(state.view).toEqual({ kind: "error", message: "owner role required" });
  });

  it("keeps only the tail of the log", () => {
    let state = reduceBetaDaemonRun(INITIAL_BETA_DAEMON_RUN_STATE, {
      type: "start",
      action: "install",
    });
    state = reduceBetaDaemonRun(state, { type: "accepted", runId: "r1" });
    for (let i = 0; i < BETA_DAEMON_LOG_LIMIT + 5; i += 1) {
      state = reduceBetaDaemonRun(state, {
        type: "progress",
        run: run("r1", "install"),
        logLine: `line ${i}`,
      });
    }
    expect(state.log).toHaveLength(BETA_DAEMON_LOG_LIMIT);
    expect(state.log[0]).toBe("line 5");
  });
});
