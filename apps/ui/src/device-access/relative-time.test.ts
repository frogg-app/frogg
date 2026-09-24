import { describe, expect, it } from "vitest";
import { describeLastSeen, lastSeenTranslation } from "./relative-time";

const NOW = Date.parse("2026-09-23T12:00:00.000Z");

describe("describeLastSeen", () => {
  it("prefers a live connection over any timestamp", () => {
    expect(
      describeLastSeen({ connected: true, lastSeenAt: "2020-01-01T00:00:00.000Z" }, NOW),
    ).toEqual({ kind: "connected" });
  });

  it("separates a device that has never connected from a stale one", () => {
    expect(describeLastSeen({ connected: false, lastSeenAt: null }, NOW)).toEqual({
      kind: "never",
    });
    expect(describeLastSeen({ connected: false, lastSeenAt: "not a date" }, NOW)).toEqual({
      kind: "never",
    });
  });

  it("buckets elapsed time", () => {
    const at = (iso: string) => describeLastSeen({ connected: false, lastSeenAt: iso }, NOW);
    expect(at("2026-09-23T11:59:30.000Z")).toEqual({ kind: "now" });
    expect(at("2026-09-23T11:45:00.000Z")).toEqual({ kind: "minutes", value: 15 });
    expect(at("2026-09-23T06:00:00.000Z")).toEqual({ kind: "hours", value: 6 });
    expect(at("2026-09-20T12:00:00.000Z")).toEqual({ kind: "days", value: 3 });
  });

  it("never reports a negative age from a clock skew", () => {
    expect(
      describeLastSeen({ connected: false, lastSeenAt: "2026-09-23T12:05:00.000Z" }, NOW),
    ).toEqual({ kind: "now" });
  });

  it("maps every description to a key", () => {
    expect(lastSeenTranslation({ kind: "minutes", value: 3 })).toEqual({
      key: "deviceAccess.lastSeen.minutes",
      options: { count: 3 },
    });
    expect(lastSeenTranslation({ kind: "connected" }).key).toBe("deviceAccess.lastSeen.connected");
  });
});
