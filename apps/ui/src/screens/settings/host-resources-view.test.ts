import { describe, expect, it } from "vitest";
import type { OwnedStorageCategory } from "@frogg/protocol/messages";
import {
  canCleanCategory,
  formatCategorySize,
  formatLoadAverage,
  formatPercent,
  formatUsage,
  isKnownStorageCategoryId,
  sortStorageCategories,
  splitUptime,
  uptimeUnits,
  totalStorageBytes,
  usageFraction,
} from "./host-resources-view";

function category(overrides: Partial<OwnedStorageCategory>): OwnedStorageCategory {
  return {
    id: "logs",
    path: "/x",
    exists: true,
    bytes: 0,
    entryCount: 0,
    truncated: false,
    cleanable: false,
    reclaimableBytes: null,
    ...overrides,
  };
}

describe("host resources view", () => {
  it("clamps usage fractions and rejects unknown totals", () => {
    expect(usageFraction(50, 200)).toBe(0.25);
    expect(usageFraction(300, 200)).toBe(1);
    expect(usageFraction(-1, 200)).toBe(0);
    expect(usageFraction(5, 0)).toBeNull();
  });

  it("formats percentages including daemon CPU above 100", () => {
    expect(formatPercent(12.6)).toBe("13%");
    expect(formatPercent(250)).toBe("250%");
    expect(formatPercent(null)).toBeNull();
  });

  it("formats usage and truncated sizes", () => {
    expect(formatUsage(1024, 2048)).toBe("1.0 KiB / 2.0 KiB");
    expect(formatCategorySize({ bytes: 1024 * 1024, truncated: false })).toBe("1.0 MiB");
    expect(formatCategorySize({ bytes: 1024 * 1024, truncated: true })).toBe("≥ 1.0 MiB");
  });

  it("splits uptime", () => {
    expect(splitUptime(90_061)).toEqual({ days: 1, hours: 1, minutes: 1 });
    expect(splitUptime(-5)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });

  it("drops zero uptime units but always shows minutes when empty", () => {
    expect(uptimeUnits(60)).toEqual([{ unit: "minutes", count: 1 }]);
    expect(uptimeUnits(0)).toEqual([{ unit: "minutes", count: 0 }]);
    expect(uptimeUnits(86_400 + 120)).toEqual([
      { unit: "days", count: 1 },
      { unit: "minutes", count: 2 },
    ]);
  });

  it("formats load average or null", () => {
    expect(formatLoadAverage([0.5, 1, 1.234])).toBe("0.50 · 1.00 · 1.23");
    expect(formatLoadAverage(null)).toBeNull();
  });

  it("orders known categories canonically and keeps unknown ids", () => {
    const sorted = sortStorageCategories([
      category({ id: "zeta" }),
      category({ id: "temp" }),
      category({ id: "alpha" }),
      category({ id: "logs" }),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["logs", "temp", "alpha", "zeta"]);
    expect(isKnownStorageCategoryId("alpha")).toBe(false);
    expect(isKnownStorageCategoryId("tts_cache")).toBe(true);
  });

  it("totals existing categories and propagates truncation", () => {
    expect(
      totalStorageBytes([
        category({ bytes: 10 }),
        category({ bytes: 5, exists: false }),
        category({ bytes: 7, truncated: true }),
      ]),
    ).toEqual({ bytes: 17, truncated: true });
  });

  it("offers clean only for cleanable categories with something to free", () => {
    expect(canCleanCategory(category({ cleanable: true, reclaimableBytes: 5 }))).toBe(true);
    expect(canCleanCategory(category({ cleanable: true, reclaimableBytes: 0 }))).toBe(false);
    expect(canCleanCategory(category({ cleanable: false, reclaimableBytes: 5 }))).toBe(false);
    expect(
      canCleanCategory(category({ cleanable: true, exists: false, reclaimableBytes: 5 })),
    ).toBe(false);
  });
});
