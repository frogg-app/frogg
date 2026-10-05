import { describe, expect, test, vi } from "vitest";
import pino from "pino";
import type { MutableStorageAlertsConfig, StorageAlertLevel } from "@frogg/protocol/messages";
import type { OwnedStorageReport, StorageCategory } from "./owned-storage.js";
import {
  StorageAlertMonitor,
  evaluateStorageAlert,
  isAtOrAbove,
  levelForBytes,
} from "./storage-alerts.js";

const GIB = 1024 ** 3;

const alerts: MutableStorageAlertsConfig = {
  enabled: true,
  warnBytes: 20 * GIB,
  criticalBytes: 50 * GIB,
  notifyAt: "warn",
};

function category(overrides: Partial<StorageCategory> & Pick<StorageCategory, "id">) {
  return {
    path: null,
    exists: true,
    bytes: 0,
    entryCount: 0,
    truncated: false,
    cleanable: false,
    reclaimableBytes: null,
    ...overrides,
  } as StorageCategory;
}

function report(categories: StorageCategory[]): OwnedStorageReport {
  return { computedAt: "2026-10-04T00:00:00.000Z", categories };
}

describe("storage alert levels", () => {
  test("steps up at each threshold", () => {
    expect(levelForBytes(19 * GIB, alerts)).toBe("ok");
    expect(levelForBytes(20 * GIB, alerts)).toBe("warn");
    expect(levelForBytes(50 * GIB, alerts)).toBe("critical");
  });

  test("a critical threshold at or below the warning one still reads as critical", () => {
    const inverted = { ...alerts, criticalBytes: 5 * GIB };
    expect(levelForBytes(19 * GIB, inverted)).toBe("ok");
    expect(levelForBytes(20 * GIB, inverted)).toBe("critical");
  });

  test("ranks levels for the notify threshold", () => {
    expect(isAtOrAbove("warn", "warn")).toBe(true);
    expect(isAtOrAbove("warn", "critical")).toBe(false);
    expect(isAtOrAbove("critical", "warn")).toBe(true);
  });
});

describe("evaluateStorageAlert", () => {
  test("totals the categories that exist and counts only cleanable bytes as reclaimable", () => {
    const alert = evaluateStorageAlert(
      report([
        category({ id: "worktrees", bytes: 21 * GIB, cleanable: true, reclaimableBytes: 9 * GIB }),
        // Cleanable on the wire but not an operator category: still reclaimable.
        category({ id: "logs", bytes: GIB, cleanable: true, reclaimableBytes: GIB }),
        // Size-only, and a missing category contributes nothing at all.
        category({ id: "projects", bytes: 5 * GIB }),
        category({ id: "models", bytes: 100 * GIB, exists: false }),
      ]),
      alerts,
    );
    expect(alert).toMatchObject({
      level: "warn",
      totalBytes: 27 * GIB,
      reclaimableBytes: 10 * GIB,
      truncated: false,
    });
  });

  test("marks the total as a lower bound when a walk was truncated", () => {
    const alert = evaluateStorageAlert(
      report([category({ id: "agents", bytes: GIB, truncated: true })]),
      alerts,
    );
    expect(alert.truncated).toBe(true);
  });

  test("stays at ok while alerts are switched off", () => {
    const alert = evaluateStorageAlert(report([category({ id: "worktrees", bytes: 500 * GIB })]), {
      ...alerts,
      enabled: false,
    });
    expect(alert.level).toBe("ok");
    expect(alert.totalBytes).toBe(500 * GIB);
  });
});

describe("StorageAlertMonitor", () => {
  function monitorFor(sizes: number[]) {
    const changes: { level: StorageAlertLevel; previousLevel: StorageAlertLevel }[] = [];
    let index = 0;
    const monitor = new StorageAlertMonitor({
      storage: {
        list: vi.fn(async () => {
          const bytes = sizes[Math.min(index++, sizes.length - 1)] ?? 0;
          return report([category({ id: "worktrees", bytes })]);
        }),
      },
      getAlerts: () => alerts,
      onLevelChange: (alert, previousLevel) => changes.push({ level: alert.level, previousLevel }),
      logger: pino({ level: "silent" }),
    });
    return { monitor, changes };
  }

  test("reports a rise and a recovery, and says nothing in between", async () => {
    const { monitor, changes } = monitorFor([GIB, 21 * GIB, 22 * GIB, 60 * GIB, GIB]);
    for (let i = 0; i < 5; i += 1) await monitor.check();
    expect(changes).toEqual([
      { level: "warn", previousLevel: "ok" },
      { level: "critical", previousLevel: "warn" },
      { level: "ok", previousLevel: "critical" },
    ]);
    expect(monitor.current()?.level).toBe("ok");
  });

  test("keeps the last level when a measurement fails", async () => {
    const changes: StorageAlertLevel[] = [];
    const monitor = new StorageAlertMonitor({
      storage: { list: vi.fn(async () => Promise.reject(new Error("disk busy"))) },
      getAlerts: () => alerts,
      onLevelChange: (alert) => changes.push(alert.level),
      logger: pino({ level: "silent" }),
    });
    expect(await monitor.check()).toBeNull();
    expect(changes).toEqual([]);
  });
});
