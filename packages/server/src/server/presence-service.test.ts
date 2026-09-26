import { describe, expect, test } from "vitest";

import {
  createPresenceService,
  PRESENCE_DERIVED_ACTIVITY_MS,
  PRESENCE_ENTRY_TTL_MS,
} from "./presence-service.js";

const agent = { kind: "agent", agentId: "agent-1" } as const;
const terminal = { kind: "terminal", terminalId: "term-1" } as const;

function identity(id: string, name = id) {
  return { participantId: id, deviceId: `device-${id}`, deviceName: name, clientType: "mobile" };
}

function serviceWithClock() {
  let clock = 1_000;
  const service = createPresenceService({ now: () => clock });
  return { service, advance: (ms: number) => (clock += ms) };
}

describe("presence service", () => {
  test("reports a participant per target, and marks the caller's own entry", () => {
    const { service } = serviceWithClock();
    service.report(identity("a", "Desk"), agent, "viewing");
    service.report(identity("b", "Phone"), agent, "typing");
    service.report(identity("b", "Phone"), terminal, "viewing");

    const snapshot = service.snapshot(agent, "b");
    expect(snapshot.participants.map((p) => [p.deviceName, p.activity, p.isSelf])).toEqual([
      ["Desk", "viewing", false],
      ["Phone", "typing", true],
    ]);
    expect(service.snapshot(terminal, null).participants).toHaveLength(1);
  });

  test("leaving removes the entry and notifies subscribers", () => {
    const { service } = serviceWithClock();
    const seen: string[] = [];
    service.subscribe((target) => seen.push(target.kind === "agent" ? target.agentId : "terminal"));
    service.report(identity("a"), agent, "viewing");
    service.report(identity("a"), agent, "left");
    expect(service.snapshot(agent, null).participants).toEqual([]);
    expect(seen).toEqual(["agent-1", "agent-1"]);
  });

  test("a re-report that changes nothing does not wake other clients", () => {
    const { service, advance } = serviceWithClock();
    service.report(identity("a"), agent, "viewing");
    let notifications = 0;
    service.subscribe(() => (notifications += 1));
    advance(30_000);
    service.report(identity("a"), agent, "viewing");
    expect(notifications).toBe(0);
    service.report(identity("a"), agent, "typing");
    expect(notifications).toBe(1);
  });

  test("an entry expires when its client stops re-reporting", () => {
    const { service, advance } = serviceWithClock();
    service.report(identity("a"), agent, "viewing");
    advance(PRESENCE_ENTRY_TTL_MS + 1);
    expect(service.snapshot(agent, null).participants).toEqual([]);
  });

  test("a daemon-observed activity outranks the reported state, then decays back", () => {
    const { service, advance } = serviceWithClock();
    service.report(identity("a"), agent, "viewing");
    service.noteActivity(identity("a"), agent, "sending");
    expect(service.snapshot(agent, null).participants[0]!.activity).toBe("sending");
    advance(PRESENCE_DERIVED_ACTIVITY_MS + 1);
    expect(service.snapshot(agent, null).participants[0]!.activity).toBe("viewing");
  });

  test("a disconnect drops the participant from every target it was on", () => {
    const { service } = serviceWithClock();
    service.report(identity("a"), agent, "viewing");
    service.report(identity("a"), terminal, "viewing");
    service.report(identity("b"), agent, "viewing");

    service.leaveAll("a");
    expect(service.snapshot(agent, null).participants.map((p) => p.participantId)).toEqual(["b"]);
    expect(service.snapshot(terminal, null).participants).toEqual([]);
  });

  test("an unknown participant leaving is silent", () => {
    const { service } = serviceWithClock();
    let notifications = 0;
    service.subscribe(() => (notifications += 1));
    service.report(identity("ghost"), agent, "left");
    service.leaveAll("ghost");
    expect(notifications).toBe(0);
  });

  test("lists every live target a connection is present on, and carries its client key", () => {
    const { service, advance } = serviceWithClock();
    service.report({ ...identity("a"), clientKey: "key-a" }, agent, "viewing");
    service.report(identity("a"), terminal, "viewing");
    service.report(identity("b"), agent, "viewing");

    expect(service.targetsFor("a")).toEqual([agent, terminal]);
    expect(service.snapshot(agent, null).participants[0]!.clientKey).toBe("key-a");
    advance(PRESENCE_ENTRY_TTL_MS + 1);
    expect(service.targetsFor("a")).toEqual([]);
  });
});
