import { describe, expect, it } from "vitest";
import type { PresenceParticipant, PresenceSnapshot } from "@frogg/protocol/device-access";
import {
  PRESENCE_ENTRY_TTL_MS,
  isPresenceSnapshotStale,
  resolvePresenceView,
  selectOtherParticipants,
  selectPresenceWarning,
} from "./snapshot";

const NOW = Date.parse("2026-09-23T12:00:00.000Z");

function participant(overrides: Partial<PresenceParticipant> = {}): PresenceParticipant {
  return {
    participantId: "p1",
    deviceId: "device-1",
    deviceName: "Ada's laptop",
    clientType: "desktop",
    activity: "viewing",
    activityAt: new Date(NOW - 1_000).toISOString(),
    isSelf: false,
    ...overrides,
  };
}

function snapshot(participants: PresenceParticipant[]): PresenceSnapshot {
  return { target: { kind: "agent", agentId: "agent-1" }, participants };
}

describe("selectOtherParticipants", () => {
  it("drops this session's own entry", () => {
    const others = selectOtherParticipants(
      snapshot([
        participant({ participantId: "self", isSelf: true, deviceName: "This phone" }),
        participant({ participantId: "other" }),
      ]),
      NOW,
    );
    expect(others.map((other) => other.participantId)).toEqual(["other"]);
  });

  it("sanitizes and truncates a hostile device name", () => {
    const hostile = `evil\n‮name\u0000${"x".repeat(500)}`;
    const [other] = selectOtherParticipants(snapshot([participant({ deviceName: hostile })]), NOW);
    expect(other?.deviceName).not.toContain("\n");
    expect(other?.deviceName).not.toContain("‮");
    expect(other?.deviceName).not.toContain("\u0000");
    expect(other?.deviceName.length).toBeLessThanOrEqual(48);
    expect(other?.deviceName.endsWith("…")).toBe(true);
  });

  it("reports an entry older than the daemon's TTL as expired", () => {
    const [other] = selectOtherParticipants(
      snapshot([
        participant({ activityAt: new Date(NOW - PRESENCE_ENTRY_TTL_MS - 1).toISOString() }),
      ]),
      NOW,
    );
    expect(other?.isExpired).toBe(true);
  });
});

describe("isPresenceSnapshotStale", () => {
  it("is live inside the TTL and stale past it", () => {
    expect(isPresenceSnapshotStale({ receivedAt: NOW - 1_000, now: NOW })).toBe(false);
    expect(isPresenceSnapshotStale({ receivedAt: NOW - PRESENCE_ENTRY_TTL_MS, now: NOW })).toBe(
      true,
    );
  });

  it("treats a snapshot that never arrived as stale", () => {
    expect(isPresenceSnapshotStale({ receivedAt: 0, now: NOW })).toBe(true);
  });
});

describe("resolvePresenceView", () => {
  it("hides itself while presence is off, has nobody else, or failed", () => {
    expect(
      resolvePresenceView({ snapshot: null, receivedAt: 0, status: "idle", now: NOW }),
    ).toEqual({ kind: "hidden" });
    expect(
      resolvePresenceView({ snapshot: null, receivedAt: 0, status: "failed", now: NOW }),
    ).toEqual({ kind: "hidden" });
    expect(
      resolvePresenceView({
        snapshot: snapshot([participant({ isSelf: true })]),
        receivedAt: NOW,
        status: "ready",
        now: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("waits on the first snapshot", () => {
    expect(
      resolvePresenceView({ snapshot: null, receivedAt: 0, status: "loading", now: NOW }),
    ).toEqual({ kind: "loading" });
  });

  it("collapses the tail of a crowd into an overflow count", () => {
    const crowd = ["a", "b", "c", "d", "e"].map((id) => participant({ participantId: id }));
    const view = resolvePresenceView({
      snapshot: snapshot(crowd),
      receivedAt: NOW,
      status: "ready",
      now: NOW,
      visibleLimit: 3,
    });
    expect(view.kind).toBe("list");
    if (view.kind !== "list") return;
    expect(view.visible).toHaveLength(3);
    expect(view.overflowCount).toBe(2);
    expect(view.isStale).toBe(false);
  });

  it("shows an old snapshot as stale rather than as live", () => {
    const view = resolvePresenceView({
      snapshot: snapshot([participant()]),
      receivedAt: NOW - PRESENCE_ENTRY_TTL_MS - 1,
      status: "ready",
      now: NOW,
    });
    expect(view.kind === "list" && view.isStale).toBe(true);
  });
});

describe("selectPresenceWarning", () => {
  function warningFor(participants: PresenceParticipant[], receivedAt = NOW) {
    return selectPresenceWarning(
      resolvePresenceView({
        snapshot: snapshot(participants),
        receivedAt,
        status: "ready",
        now: NOW,
      }),
    );
  }

  it("names the other person who is typing", () => {
    const warning = warningFor([participant({ activity: "typing", deviceName: "Ada's laptop" })]);
    expect(warning).toEqual({
      deviceName: "Ada's laptop",
      clientKey: null,
      activity: "typing",
      additionalCount: 0,
    });
  });

  it("does not warn when nobody else is there", () => {
    expect(warningFor([])).toBeNull();
  });

  it("never warns about this session's own entry", () => {
    expect(warningFor([participant({ activity: "typing", isSelf: true })])).toBeNull();
  });

  it("does not warn about someone who is only watching", () => {
    expect(warningFor([participant({ activity: "viewing" })])).toBeNull();
    expect(warningFor([participant({ activity: "idle" })])).toBeNull();
  });

  it("counts the other active people beyond the named one", () => {
    const warning = warningFor([
      participant({ participantId: "a", activity: "typing", deviceName: "Ada" }),
      participant({ participantId: "b", activity: "sending", deviceName: "Grace" }),
    ]);
    expect(warning?.additionalCount).toBe(1);
  });

  it("does not warn from a stale snapshot", () => {
    expect(
      warningFor([participant({ activity: "typing" })], NOW - PRESENCE_ENTRY_TTL_MS - 1),
    ).toBeNull();
  });
});
