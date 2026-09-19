import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import type {
  DaemonAutoUpdateConfig,
  DaemonUpdateLastResult,
  DaemonUpdateRun,
} from "@frogg/protocol/messages";
import {
  type AutoUpdateAttemptStore,
  DaemonAutoUpdater,
  MAX_AUTO_UPDATE_BACKOFF_MS,
  autoUpdateBackoffMs,
  createFileAutoUpdateAttemptStore,
  isInQuietHours,
} from "./daemon-auto-updater.js";
import type { CheckPayload, StartPayload } from "./daemon-update-service.js";

function fakeService(input: {
  updatable?: boolean;
  latest?: string | null;
  error?: string | null;
}) {
  const starts: { version?: string }[] = [];
  let run: DaemonUpdateRun | null = null;
  const service = {
    installInfo: {
      installDir: "/x",
      updatable: input.updatable ?? true,
      reason: null,
      runningRoot: null,
      cliLauncher: null,
    },
    currentRun: () => run,
    async check(): Promise<CheckPayload> {
      return {
        updatable: true,
        reason: null,
        currentVersion: "0.1.13",
        channel: "stable",
        latestVersion: input.latest ?? null,
        updateAvailable: Boolean(input.latest),
        releaseUrl: null,
        error: input.error ?? null,
      };
    },
    async start(options: { version?: string }): Promise<StartPayload> {
      starts.push(options);
      run = {
        runId: "r",
        from: "0.1.13",
        to: options.version ?? "?",
        phase: "check",
        message: null,
        at: "t",
      };
      return {
        accepted: true,
        runId: "r",
        targetVersion: options.version ?? null,
        error: null,
      };
    },
  };
  return { service, starts };
}

function makeUpdater(input: {
  config: Partial<DaemonAutoUpdateConfig>;
  service: ReturnType<typeof fakeService>["service"];
  agentsRunning?: boolean;
  now?: Date;
  lastResult?: DaemonUpdateLastResult | null;
  attempts?: AutoUpdateAttemptStore;
}) {
  return new DaemonAutoUpdater({
    service: input.service,
    getConfig: () => ({
      enabled: true,
      channel: "stable",
      checkIntervalHours: 24,
      quietHours: null,
      ...input.config,
    }),
    hasRunningAgents: () => input.agentsRunning ?? false,
    lastResult: () => input.lastResult ?? null,
    attempts: input.attempts,
    logger: pino({ level: "silent" }),
    now: () => input.now ?? new Date(2026, 8, 3, 14, 0, 0),
  });
}

describe("quiet hours", () => {
  test("covers plain and wrap-around windows", () => {
    expect(isInQuietHours(new Date(2026, 8, 3, 10), [9, 17])).toBe(true);
    expect(isInQuietHours(new Date(2026, 8, 3, 17), [9, 17])).toBe(false);
    expect(isInQuietHours(new Date(2026, 8, 3, 23), [22, 6])).toBe(true);
    expect(isInQuietHours(new Date(2026, 8, 3, 3), [22, 6])).toBe(true);
    expect(isInQuietHours(new Date(2026, 8, 3, 12), [22, 6])).toBe(false);
    expect(isInQuietHours(new Date(2026, 8, 3, 12), null)).toBe(false);
    expect(isInQuietHours(new Date(2026, 8, 3, 12), [12, 12])).toBe(false);
  });
});

describe("DaemonAutoUpdater.tick", () => {
  test("stays idle when disabled, not updatable, up to date, or inside quiet hours", async () => {
    const off = fakeService({ latest: "0.1.14" });
    expect(
      await makeUpdater({
        config: { enabled: false },
        service: off.service,
      }).tick(),
    ).toBe("disabled");
    const fixed = fakeService({ updatable: false, latest: "0.1.14" });
    expect(await makeUpdater({ config: {}, service: fixed.service }).tick()).toBe("not_updatable");
    const current = fakeService({ latest: null });
    expect(await makeUpdater({ config: {}, service: current.service }).tick()).toBe("up_to_date");
    const quiet = fakeService({ latest: "0.1.14" });
    expect(
      await makeUpdater({
        config: { quietHours: [13, 15] },
        service: quiet.service,
      }).tick(),
    ).toBe("quiet_hours");
    expect(quiet.starts).toEqual([]);
    const broken = fakeService({ error: "rate limited" });
    expect(await makeUpdater({ config: {}, service: broken.service }).tick()).toBe("check_failed");
  });

  test("defers while agents are running and starts the update once they are idle", async () => {
    const busy = fakeService({ latest: "0.1.14" });
    expect(
      await makeUpdater({
        config: {},
        service: busy.service,
        agentsRunning: true,
      }).tick(),
    ).toBe("busy");
    expect(busy.starts).toEqual([]);

    const idle = fakeService({ latest: "0.1.14" });
    const updater = makeUpdater({
      config: { channel: "beta" },
      service: idle.service,
    });
    expect(await updater.tick()).toBe("started");
    expect(idle.starts).toEqual([{ version: "0.1.14", channel: "beta" }]);
    expect(await updater.tick()).toBe("already_running");
  });
});

describe("retry backoff", () => {
  const now = new Date(2026, 8, 19, 12, 50, 0);
  const failed = (to: string, at: Date): DaemonUpdateLastResult => ({
    from: "1.5.6",
    to,
    status: "failed",
    reason: "daemon reports version 0.6.13, expected 1.5.7",
    at: at.toISOString(),
  });

  test("does not retry a version whose last attempt failed within the interval", async () => {
    const fake = fakeService({ latest: "1.5.7" });
    const updater = makeUpdater({
      config: {},
      service: fake.service,
      now,
      lastResult: failed("1.5.7", new Date(now.getTime() - 10 * 60_000)),
    });
    expect(await updater.tick()).toBe("backed_off");
    expect(fake.starts).toEqual([]);
  });

  test("retries once the interval has passed, and never blocks a newer version", async () => {
    const stale = fakeService({ latest: "1.5.7" });
    expect(
      await makeUpdater({
        config: {},
        service: stale.service,
        now,
        lastResult: failed("1.5.7", new Date(now.getTime() - 25 * 3_600_000)),
      }).tick(),
    ).toBe("started");
    const newer = fakeService({ latest: "1.5.8" });
    expect(
      await makeUpdater({
        config: {},
        service: newer.service,
        now,
        lastResult: failed("1.5.7", now),
      }).tick(),
    ).toBe("started");
  });
});

describe("persisted exponential backoff", () => {
  const H = 3_600_000;
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  function store() {
    const dir = mkdtempSync(path.join(tmpdir(), "auto-update-attempts-"));
    dirs.push(dir);
    return { dir, store: createFileAutoUpdateAttemptStore(dir) };
  }
  const failedAt = (to: string, at: Date): DaemonUpdateLastResult => ({
    from: "1.5.6",
    to,
    status: "rolled_back",
    reason: "daemon did not come up",
    at: at.toISOString(),
  });

  test("backoff doubles per attempt and is capped", () => {
    expect(autoUpdateBackoffMs(1, 24)).toBe(24 * H);
    expect(autoUpdateBackoffMs(2, 24)).toBe(48 * H);
    expect(autoUpdateBackoffMs(3, 24)).toBe(96 * H);
    expect(autoUpdateBackoffMs(10, 24)).toBe(MAX_AUTO_UPDATE_BACKOFF_MS);
    expect(autoUpdateBackoffMs(1000, 1)).toBe(MAX_AUTO_UPDATE_BACKOFF_MS);
  });

  test("attempts survive a restart (fresh updater, same store) and grow the wait", async () => {
    const { dir } = store();
    const t0 = new Date(2026, 8, 19, 0, 0, 0);
    // Attempt 1 by the first daemon process.
    const first = fakeService({ latest: "1.5.7" });
    expect(
      await makeUpdater({
        config: {},
        service: first.service,
        now: t0,
        attempts: createFileAutoUpdateAttemptStore(dir),
      }).tick(),
    ).toBe("started");
    expect(createFileAutoUpdateAttemptStore(dir).read()).toMatchObject({
      version: "1.5.7",
      attempts: 1,
    });

    // The rolled-back daemon restarts: new process, new updater, same file.
    const at = (hours: number) => new Date(t0.getTime() + hours * H);
    const tickAt = async (hours: number) => {
      const fake = fakeService({ latest: "1.5.7" });
      const outcome = await makeUpdater({
        config: {},
        service: fake.service,
        now: at(hours),
        lastResult: failedAt("1.5.7", at(0)),
        attempts: createFileAutoUpdateAttemptStore(dir),
      }).tick();
      return outcome;
    };
    expect(await tickAt(0.1)).toBe("backed_off");
    expect(await tickAt(23)).toBe("backed_off");
    expect(await tickAt(24)).toBe("started"); // attempt 2 at t=24h
    expect(createFileAutoUpdateAttemptStore(dir).read()?.attempts).toBe(2);
    expect(await tickAt(24 + 47)).toBe("backed_off");
    expect(await tickAt(24 + 48)).toBe("started"); // attempt 3 at t=72h
    expect(await tickAt(72 + 95)).toBe("backed_off");
    expect(await tickAt(72 + 96)).toBe("started");
    expect(createFileAutoUpdateAttemptStore(dir).read()?.attempts).toBe(4);
  });

  test("a newer version resets the count and starts at once", async () => {
    const { dir, store: attempts } = store();
    const now = new Date(2026, 8, 19, 12, 0, 0);
    attempts.write({
      version: "1.5.7",
      attempts: 5,
      lastAttemptAt: now.toISOString(),
    });
    const fake = fakeService({ latest: "1.5.8" });
    expect(
      await makeUpdater({
        config: {},
        service: fake.service,
        now,
        lastResult: failedAt("1.5.7", now),
        attempts,
      }).tick(),
    ).toBe("started");
    expect(createFileAutoUpdateAttemptStore(dir).read()).toMatchObject({
      version: "1.5.8",
      attempts: 1,
    });
  });

  test("success (up to date, or applied record) clears the count", async () => {
    const { store: attempts } = store();
    const now = new Date(2026, 8, 19, 12, 0, 0);
    attempts.write({
      version: "1.5.7",
      attempts: 3,
      lastAttemptAt: now.toISOString(),
    });
    const current = fakeService({ latest: null });
    expect(
      await makeUpdater({
        config: {},
        service: current.service,
        now,
        attempts,
      }).tick(),
    ).toBe("up_to_date");
    expect(attempts.read()).toBeNull();

    attempts.write({
      version: "1.5.7",
      attempts: 3,
      lastAttemptAt: now.toISOString(),
    });
    const applied = fakeService({ latest: "1.5.7" });
    expect(
      await makeUpdater({
        config: {},
        service: applied.service,
        now,
        lastResult: {
          from: "1.5.6",
          to: "1.5.7",
          status: "applied",
          reason: null,
          at: now.toISOString(),
        },
        attempts,
      }).tick(),
    ).toBe("started");
    expect(attempts.read()?.attempts).toBe(1);
  });

  test("a corrupt state file is ignored", async () => {
    const { dir } = store();
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(path.join(dir, "daemon-update"), { recursive: true });
    writeFileSync(path.join(dir, "daemon-update", "auto-update-attempts.json"), "{nope");
    expect(createFileAutoUpdateAttemptStore(dir).read()).toBeNull();
  });
});
