import { describe, expect, test } from "vitest";

import { createAuthFailureLimiter } from "./auth-rate-limit.js";

describe("auth failure limiter", () => {
  test("blocks a key after the failure budget and unblocks when the block expires", () => {
    let now = 1_000;
    const limiter = createAuthFailureLimiter({
      maxFailures: 3,
      windowMs: 60_000,
      blockMs: 30_000,
      now: () => now,
    });

    limiter.recordFailure("a");
    limiter.recordFailure("a");
    expect(limiter.isBlocked("a")).toBe(false);
    limiter.recordFailure("a");
    expect(limiter.isBlocked("a")).toBe(true);
    expect(limiter.retryAfterSeconds("a")).toBe(30);
    // Other clients are unaffected.
    expect(limiter.isBlocked("b")).toBe(false);

    now += 30_001;
    expect(limiter.isBlocked("a")).toBe(false);
    expect(limiter.retryAfterSeconds("a")).toBe(0);
  });

  test("forgets failures older than the window", () => {
    let now = 0;
    const limiter = createAuthFailureLimiter({
      maxFailures: 2,
      windowMs: 10_000,
      blockMs: 10_000,
      now: () => now,
    });

    limiter.recordFailure("a");
    now += 10_001;
    limiter.recordFailure("a");
    expect(limiter.isBlocked("a")).toBe(false);
  });

  test("a success clears the key's failures", () => {
    const limiter = createAuthFailureLimiter({ maxFailures: 2 });
    limiter.recordFailure("a");
    limiter.recordSuccess("a");
    limiter.recordFailure("a");
    expect(limiter.isBlocked("a")).toBe(false);
  });

  test("a success does not lift an active block", () => {
    const limiter = createAuthFailureLimiter({ maxFailures: 1 });
    limiter.recordFailure("a");
    expect(limiter.isBlocked("a")).toBe(true);
    limiter.recordSuccess("a");
    expect(limiter.isBlocked("a")).toBe(true);
  });

  test("bounds how many keys it tracks", () => {
    const limiter = createAuthFailureLimiter({ maxKeys: 2, maxFailures: 1 });
    limiter.recordFailure("a");
    limiter.recordFailure("b");
    limiter.recordFailure("c");
    // The oldest key was evicted rather than growing without bound.
    expect(limiter.isBlocked("a")).toBe(false);
    expect(limiter.isBlocked("c")).toBe(true);
  });
});
