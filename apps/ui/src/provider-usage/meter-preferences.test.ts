import { describe, expect, test } from "vitest";
import {
  DEFAULT_USAGE_METER_PREFERENCES,
  deriveUsageTone,
  normalizeUsageMeterPreferences,
  normalizeUsageThresholds,
  parseUsageRefreshInterval,
} from "./meter-preferences";

describe("parseUsageRefreshInterval", () => {
  test("keeps a sane interval as given", () => {
    expect(parseUsageRefreshInterval(30)).toBe(30);
  });

  test("treats zero and negatives as the timer being off", () => {
    expect(parseUsageRefreshInterval(0)).toBe(0);
    expect(parseUsageRefreshInterval(-10)).toBe(0);
  });

  test("clamps a too-eager interval rather than letting it poll flat out", () => {
    expect(parseUsageRefreshInterval(1)).toBe(5);
    expect(parseUsageRefreshInterval(100_000)).toBe(3600);
  });

  test("falls back to the default rather than to no refreshing", () => {
    expect(parseUsageRefreshInterval("nonsense")).toBe(
      DEFAULT_USAGE_METER_PREFERENCES.refreshIntervalSeconds,
    );
  });
});

describe("normalizeUsageThresholds", () => {
  test("leaves an ordered pair alone", () => {
    expect(normalizeUsageThresholds({ warningThresholdPct: 65, criticalThresholdPct: 90 })).toEqual(
      {
        warningThresholdPct: 65,
        criticalThresholdPct: 90,
      },
    );
  });

  test("pushes red above amber when the pair crosses", () => {
    expect(normalizeUsageThresholds({ warningThresholdPct: 95, criticalThresholdPct: 80 })).toEqual(
      {
        warningThresholdPct: 95,
        criticalThresholdPct: 96,
      },
    );
  });

  test("keeps red reachable when amber is pinned at the top", () => {
    const result = normalizeUsageThresholds({
      warningThresholdPct: 100,
      criticalThresholdPct: 100,
    });
    expect(result.warningThresholdPct).toBeLessThan(result.criticalThresholdPct);
    expect(result.criticalThresholdPct).toBeLessThanOrEqual(100);
  });
});

describe("deriveUsageTone", () => {
  const thresholds = { warningThresholdPct: 65, criticalThresholdPct: 90 };

  test("is quiet below the warning level", () => {
    expect(deriveUsageTone(64, thresholds)).toBe("default");
  });

  test("treats both thresholds as exclusive", () => {
    expect(deriveUsageTone(65, thresholds)).toBe("default");
    expect(deriveUsageTone(65.5, thresholds)).toBe("warning");
    expect(deriveUsageTone(90, thresholds)).toBe("warning");
    expect(deriveUsageTone(90.5, thresholds)).toBe("danger");
  });

  test("says nothing about a window with no reported figure", () => {
    expect(deriveUsageTone(null, thresholds)).toBe("default");
    expect(deriveUsageTone(Number.NaN, thresholds)).toBe("default");
  });
});

describe("normalizeUsageMeterPreferences", () => {
  test("repairs a hand-edited record instead of discarding every field", () => {
    expect(
      normalizeUsageMeterPreferences({
        refreshIntervalSeconds: 1,
        warningThresholdPct: 95,
        criticalThresholdPct: 10,
        refreshOnHover: false,
      }),
    ).toEqual({
      ...DEFAULT_USAGE_METER_PREFERENCES,
      refreshIntervalSeconds: 5,
      warningThresholdPct: 95,
      criticalThresholdPct: 96,
      refreshOnHover: false,
    });
  });
});
