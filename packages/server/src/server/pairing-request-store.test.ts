import { describe, expect, test, vi } from "vitest";

import { createPairingRequestStore } from "./pairing-request-store.js";

describe("pairing request store", () => {
  function create(store: ReturnType<typeof createPairingRequestStore>, deviceName = "Phone") {
    const record = store.create({ deviceName, remoteAddress: "192.168.1.20" });
    if (!record) throw new Error("expected a pairing request");
    return record;
  }

  test("an approval is collected once, by the device that asked", () => {
    const store = createPairingRequestStore();
    const record = create(store);

    expect(store.poll(record.pollId)).toMatchObject({ status: "pending" });
    expect(store.list()).toHaveLength(1);

    store.decide({ id: record.id, decision: "approve", role: "viewer", name: "Renamed" });
    expect(store.poll(record.pollId)).toEqual({
      status: "approved",
      role: "viewer",
      name: "Renamed",
    });
    // Replaying the poll id gets nothing.
    expect(store.poll(record.pollId)).toBeNull();
    expect(store.list()).toHaveLength(0);
  });

  test("a denial resolves the request without approving it", () => {
    const store = createPairingRequestStore();
    const record = create(store);
    store.decide({ id: record.id, decision: "deny" });
    expect(store.poll(record.pollId)).toEqual({ status: "denied" });
    expect(store.list()).toHaveLength(0);
  });

  test("a request expires and can no longer be approved", () => {
    let now = 0;
    const store = createPairingRequestStore({ ttlMs: 1000, now: () => now });
    const record = create(store);
    now += 1001;
    expect(store.list()).toHaveLength(0);
    expect(store.decide({ id: record.id, decision: "approve" })).toBeNull();
    expect(store.poll(record.pollId)).toBeNull();
  });

  test("bounds pending requests so an owner's screen cannot be flooded", () => {
    const store = createPairingRequestStore({ maxPending: 2 });
    create(store);
    create(store);
    expect(store.create({ deviceName: "Third", remoteAddress: null })).toBeNull();
  });

  test("notifies listeners when the pending set changes", () => {
    const store = createPairingRequestStore();
    const listener = vi.fn();
    const off = store.onChange(listener);
    const record = create(store);
    expect(listener).toHaveBeenCalledTimes(1);
    store.decide({ id: record.id, decision: "approve" });
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    create(store, "Another");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("an unknown poll id reveals nothing", () => {
    const store = createPairingRequestStore();
    create(store);
    expect(store.poll("made-up")).toBeNull();
  });
});
