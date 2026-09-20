import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "@frogg/server";
import { resolveLocalDaemonDiagnosticState } from "./local-daemon.js";
import { runStart, type StartOptions, type StartRuntime } from "./start.js";
import type { ServiceRegistration } from "./service/state.js";

const UNIT: ServiceRegistration = {
  kind: "systemd",
  name: "frogg-daemon.service",
  path: "/config/systemd/user/frogg-daemon.service",
  enabled: true,
  active: false,
};

class FakeStartRuntime implements StartRuntime {
  states: ReturnType<StartRuntime["resolveState"]>[] = [{ running: false, pidInfo: null }];
  logs: string[] = [];
  errors: string[] = [];
  launches: StartOptions[] = [];
  failure: Error | null = null;
  resolveState: StartRuntime["resolveState"] = () => {
    const state = this.states[0];
    if (!state) throw new Error("Missing fake state");
    if (this.states.length > 1) this.states.shift();
    return state;
  };
  async startDetached(options: StartOptions) {
    this.launches.push(options);
    if (this.failure) throw this.failure;
    return { pid: 5678, logPath: "/test/frogg/daemon.log" };
  }
  startForeground(options: StartOptions) {
    this.launches.push(options);
    return 0;
  }
  log(message: string) {
    this.logs.push(message);
  }
  error(message: string) {
    this.errors.push(message);
  }
  exit(code: number): never {
    throw new Error(`exit:${code}`);
  }
  registration: ServiceRegistration | null = null;
  started: ServiceRegistration[] = [];
  serviceFailure: Error | null = null;
  detectService = () => this.registration;
  startService = (registration: ServiceRegistration) => {
    if (this.serviceFailure) throw this.serviceFailure;
    this.started.push(registration);
  };
}

describe("daemon start with a registered service", () => {
  test("an inactive unit is started instead of a detached daemon", async () => {
    const runtime = new FakeStartRuntime();
    runtime.registration = UNIT;
    await runStart({}, runtime);
    expect(runtime.started).toEqual([UNIT]);
    expect(runtime.launches).toEqual([]);
    expect(runtime.logs[0]).toContain("frogg-daemon.service");
  });

  test("an active unit is left alone", async () => {
    const runtime = new FakeStartRuntime();
    runtime.registration = { ...UNIT, active: true };
    await runStart({}, runtime);
    expect(runtime.started).toEqual([]);
    expect(runtime.launches).toEqual([{}]);
  });

  test("explicit overrides the unit cannot honour keep the manual path", async () => {
    const runtime = new FakeStartRuntime();
    runtime.registration = UNIT;
    await runStart({ listen: "127.0.0.1:9100" }, runtime);
    expect(runtime.started).toEqual([]);
    expect(runtime.launches).toEqual([{ listen: "127.0.0.1:9100" }]);
  });

  test("--foreground still runs the daemon in this process", async () => {
    const runtime = new FakeStartRuntime();
    runtime.registration = UNIT;
    // The fake exits by throwing, as it does for every foreground case here.
    await expect(runStart({ foreground: true }, runtime)).rejects.toThrow(/^exit:/);
    expect(runtime.started).toEqual([]);
    expect(runtime.launches).toEqual([{ foreground: true }]);
  });

  test("a service that will not start reports how to start a daemon anyway", async () => {
    const runtime = new FakeStartRuntime();
    runtime.registration = UNIT;
    runtime.serviceFailure = new Error("unit masked");
    await expect(runStart({}, runtime)).rejects.toThrow("exit:1");
    expect(runtime.errors[0]).toContain("unit masked");
    expect(runtime.errors[1]).toContain("--foreground");
  });
});

describe("daemon start feedback", () => {
  test.each([false, true])(
    "existing daemon is a quiet success (foreground=%s)",
    async (foreground) => {
      const runtime = new FakeStartRuntime();
      runtime.states = [{ running: true, pidInfo: { pid: 1234 } }];
      await runStart({ home: "/test/frogg", foreground }, runtime);
      expect(runtime.launches).toEqual([]);
      expect(runtime.logs).toEqual(["Daemon already running (PID 1234)."]);
      expect(runtime.errors).toEqual([]);
    },
  );

  test("a stale PID file does not prevent a new start", async () => {
    const runtime = new FakeStartRuntime();
    runtime.states = [{ running: false, pidInfo: { pid: 1234 } }];
    await runStart({ home: "/test/frogg" }, runtime);
    expect(runtime.launches).toEqual([{ home: "/test/frogg" }]);
    expect(runtime.logs[0]).toContain("PID 5678");
    expect(runtime.errors).toEqual([]);
  });

  test("a concurrent successful start suppresses the losing child's failure logs", async () => {
    const runtime = new FakeStartRuntime();
    runtime.states.push({ running: true, pidInfo: { pid: 5678 } });
    runtime.failure = new Error("Daemon failed\nRecent daemon logs: old errors");
    await runStart({}, runtime);
    expect(runtime.logs).toEqual(["Daemon already running (PID 5678)."]);
    expect(runtime.errors).toEqual([]);
  });

  test("real startup failures still report an error and fail", async () => {
    const runtime = new FakeStartRuntime();
    runtime.failure = new Error("Could not bind daemon socket");
    await expect(runStart({}, runtime)).rejects.toThrow("exit:1");
    expect(runtime.errors[0]).toContain("Could not bind daemon socket");
  });

  test("invalid start flags remain errors even with a running daemon", async () => {
    const runtime = new FakeStartRuntime();
    runtime.states = [{ running: true, pidInfo: { pid: 1234 } }];
    await expect(runStart({ listen: "0.0.0.0:9999", port: "9999" }, runtime)).rejects.toThrow(
      "exit:1",
    );
    expect(runtime.launches).toEqual([]);
    expect(runtime.errors[0]).toContain("Cannot use --listen and --port together");
  });

  test.each([false, true])(
    "schema-invalid persisted relay does not block precheck (running=%s)",
    async (running) => {
      const home = await mkdtemp(path.join(os.tmpdir(), "frogg-start-config-"));
      try {
        await writeFile(
          path.join(home, "config.json"),
          JSON.stringify({ version: 1, daemon: { relay: { enabled: "yes" } } }),
        );
        if (running)
          await writeFile(path.join(home, "frogg.pid"), JSON.stringify({ pid: process.pid }));
        expect(() => loadConfig(home, { env: {} })).toThrow("[Config] Invalid config");
        const runtime = new FakeStartRuntime();
        runtime.resolveState = resolveLocalDaemonDiagnosticState;
        await runStart({ home, relay: false }, runtime);
        if (running) {
          expect(runtime.logs).toEqual([`Daemon already running (PID ${process.pid}).`]);
          expect(runtime.launches).toEqual([]);
        } else {
          expect(runtime.launches).toEqual([{ home, relay: false }]);
        }
        expect(runtime.errors).toEqual([]);
      } finally {
        await rm(home, { recursive: true, force: true });
      }
    },
  );
});
