import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: new Map<string, string>() }));
vi.mock("@frogg/branding", () => ({ brand: { storagePrefix: "com.acme.studio:" } }));
vi.mock("@frogg/branding/identity", () => ({
  storageKey: (brand: { storagePrefix: string }, key: string) => `${brand.storagePrefix}${key}`,
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => state.rows.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      state.rows.set(key, value);
    },
    removeItem: async (key: string) => {
      state.rows.delete(key);
    },
    getAllKeys: async () => [...state.rows.keys()],
    multiGet: async (keys: string[]) => keys.map((key) => [key, state.rows.get(key) ?? null]),
    multiRemove: async (keys: string[]) => {
      for (const key of keys) state.rows.delete(key);
    },
  },
}));

import {
  KNOWN_DAEMON_KEYS_STORAGE_KEY,
  forgetDaemonFingerprint,
  readKnownDaemonFingerprint,
  readKnownDaemonKeys,
  rememberDaemonFingerprint,
} from "./known-daemon-keys";

const STORED_KEY = `com.acme.studio:${KNOWN_DAEMON_KEYS_STORAGE_KEY}`;

describe("known daemon keys", () => {
  beforeEach(() => {
    state.rows.clear();
  });

  it("has no pin for a daemon that was never paired", async () => {
    expect(await readKnownDaemonFingerprint("srv-1")).toBeNull();
    expect(await readKnownDaemonFingerprint(null)).toBeNull();
  });

  it("pins a fingerprint per server id and reads it back", async () => {
    await rememberDaemonFingerprint("srv-1", "sha256:aaa");
    await rememberDaemonFingerprint("srv-2", "sha256:bbb");
    expect(await readKnownDaemonFingerprint("srv-1")).toBe("sha256:aaa");
    expect(await readKnownDaemonFingerprint("srv-2")).toBe("sha256:bbb");
    expect(await readKnownDaemonKeys()).toEqual({ "srv-1": "sha256:aaa", "srv-2": "sha256:bbb" });
  });

  it("ignores an incomplete pin", async () => {
    await rememberDaemonFingerprint("srv-1", null);
    await rememberDaemonFingerprint(null, "sha256:aaa");
    expect(await readKnownDaemonKeys()).toEqual({});
  });

  it("drops persisted data that is not a fingerprint map", async () => {
    state.rows.set(STORED_KEY, JSON.stringify({ "srv-1": 7 }));
    expect(await readKnownDaemonKeys()).toEqual({});
    state.rows.set(STORED_KEY, "not json");
    expect(await readKnownDaemonKeys()).toEqual({});
  });

  it("forgets a single daemon without touching the others", async () => {
    await rememberDaemonFingerprint("srv-1", "sha256:aaa");
    await rememberDaemonFingerprint("srv-2", "sha256:bbb");
    await forgetDaemonFingerprint("srv-1");
    expect(await readKnownDaemonKeys()).toEqual({ "srv-2": "sha256:bbb" });
  });
});
