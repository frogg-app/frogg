import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  USAGE_STATS_LOG_FILE,
  USAGE_STATS_STATE_FILE,
  createUsageStatsReporter,
  type UsageStatsReporterDeps,
} from "./reporter.js";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function setup(overrides: Partial<UsageStatsReporterDeps> = {}) {
  const home = mkdtempSync(path.join(os.tmpdir(), "usage-stats-"));
  homes.push(home);
  const sent: unknown[] = [];
  let enabled = true;
  let clock = new Date("2026-11-02T10:11:12.000Z");
  const reporter = createUsageStatsReporter({
    froggHome: home,
    version: "1.6.14-beta.3",
    product: "frogg-daemon",
    collectorUrl: "https://collector.example.com",
    isEnabled: () => enabled,
    enabledProviders: () => 3,
    logger: { debug: () => undefined, warn: () => undefined },
    platform: "linux",
    now: () => clock,
    fetch: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch,
    ...overrides,
  });
  return {
    home,
    sent,
    reporter,
    setEnabled: (v: boolean) => (enabled = v),
    setClock: (d: string) => (clock = new Date(d)),
  };
}

describe("daemon usage statistics", () => {
  test("boot sends daemon_started and the day's daemon_active, and logs it", async () => {
    const { reporter, sent, home } = setup();
    const batch = await reporter.tick("boot");
    expect(batch?.events.map((e) => e.name)).toEqual(["daemon_started", "daemon_active"]);
    expect(batch?.events[0]).toEqual({
      name: "daemon_started",
      at: "2026-11-02T10:11:00.000Z",
      props: { providers: 3 },
    });
    expect(batch?.client).toEqual({
      product: "frogg-daemon",
      version: "1.6.14-beta.3",
      os: "linux",
    });
    expect(sent).toEqual([batch]);
    const log = readFileSync(path.join(home, USAGE_STATS_LOG_FILE), "utf8").trim().split("\n");
    expect(JSON.parse(log[0]!)).toEqual(batch);
  });

  test("daemon_active goes out at most once a day", async () => {
    const { reporter, sent, setClock } = setup();
    await reporter.tick("boot");
    expect(await reporter.tick("check")).toBeNull();
    setClock("2026-11-03T00:05:00.000Z");
    expect((await reporter.tick("check"))?.events.map((e) => e.name)).toEqual(["daemon_active"]);
    expect(sent).toHaveLength(2);
  });

  test("keeps one install id across batches and deletes it when turned off", async () => {
    const { reporter, home, setEnabled, setClock } = setup();
    const first = await reporter.tick("boot");
    setClock("2026-11-04T00:00:00.000Z");
    const second = await reporter.tick("check");
    expect(second?.installId).toBe(first?.installId);
    setEnabled(false);
    reporter.setEnabled(false);
    expect(existsSync(path.join(home, USAGE_STATS_STATE_FILE))).toBe(false);
  });

  test("sends nothing when off", async () => {
    const { reporter, sent, setEnabled, home } = setup();
    setEnabled(false);
    expect(await reporter.tick("boot")).toBeNull();
    expect(sent).toEqual([]);
    expect(existsSync(path.join(home, USAGE_STATS_LOG_FILE))).toBe(false);
  });

  test("is a no-op without a collector, even when on", async () => {
    const { reporter, sent, home } = setup({ collectorUrl: null });
    reporter.start();
    expect(await reporter.tick("boot")).toBeNull();
    expect(sent).toEqual([]);
    expect(existsSync(path.join(home, USAGE_STATS_STATE_FILE))).toBe(false);
  });

  test("a failed send is retried on the next check, not recorded", async () => {
    let fail = true;
    const { reporter, home } = setup({
      fetch: (async () =>
        fail ? Promise.reject(new Error("offline")) : new Response(null, { status: 204 })) as never,
    });
    expect(await reporter.tick("boot")).toBeNull();
    expect(existsSync(path.join(home, USAGE_STATS_LOG_FILE))).toBe(false);
    fail = false;
    expect((await reporter.tick("check"))?.events.map((e) => e.name)).toEqual(["daemon_active"]);
  });
});
