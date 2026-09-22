import { describe, expect, test } from "vitest";

import { formatPairingCode, PAIRING_CODE_LENGTH } from "@frogg/protocol/device-access";
import {
  PAIRING_CODE_MAX_TTL_SECONDS,
  PAIRING_CODE_MIN_TTL_SECONDS,
  clampPairingCodeTtlSeconds,
  createPairingCodeStore,
} from "./pairing-code-store.js";

describe("pairing code store", () => {
  test("issues a code a person can read out, and redeems it once", () => {
    const store = createPairingCodeStore();
    const issued = store.issue({ role: "viewer" });

    expect(issued.code).toHaveLength(PAIRING_CODE_LENGTH);
    expect(formatPairingCode(issued.code)).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    // Typed back with the dash, in lower case, with the ambiguous letters.
    const redeemed = store.redeem(formatPairingCode(issued.code).toLowerCase());
    expect(redeemed?.role).toBe("viewer");
    expect(store.redeem(issued.code)).toBeNull();
  });

  test("defaults to the operator role", () => {
    expect(createPairingCodeStore().issue().role).toBe("operator");
  });

  test("refuses an expired code", () => {
    let now = 0;
    const store = createPairingCodeStore({ now: () => now });
    const issued = store.issue({ ttlSeconds: 30 });
    now += 31_000;
    expect(store.redeem(issued.code)).toBeNull();
    expect(store.liveCount()).toBe(0);
  });

  test("clamps the lifetime to the documented range", () => {
    expect(clampPairingCodeTtlSeconds(undefined)).toBe(600);
    expect(clampPairingCodeTtlSeconds(1)).toBe(PAIRING_CODE_MIN_TTL_SECONDS);
    expect(clampPairingCodeTtlSeconds(999_999)).toBe(PAIRING_CODE_MAX_TTL_SECONDS);
  });

  test("bounds how many codes are live at once", () => {
    const store = createPairingCodeStore({ maxLive: 2 });
    const first = store.issue();
    store.issue();
    store.issue();
    expect(store.liveCount()).toBe(2);
    expect(store.redeem(first.code)).toBeNull();
  });

  test("rejects anything that is not a code", () => {
    const store = createPairingCodeStore();
    store.issue();
    expect(store.redeem("")).toBeNull();
    expect(store.redeem("nope")).toBeNull();
    expect(store.redeem("UUUUUUUU")).toBeNull();
  });
});
