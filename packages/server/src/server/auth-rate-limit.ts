/**
 * Failed-authentication throttle, keyed by client address. After
 * `maxFailures` failures inside `windowMs` the key is blocked for `blockMs`;
 * while blocked, callers reject without checking the secret at all. A
 * success clears the key's failures. Covers passwords, pairing codes and
 * unknown bearer tokens.
 */
export interface AuthFailureLimiter {
  isBlocked(key: string): boolean;
  recordFailure(key: string): void;
  recordSuccess(key: string): void;
  /** Seconds until the key is unblocked, or 0. */
  retryAfterSeconds(key: string): number;
}

export interface AuthFailureLimiterOptions {
  maxFailures?: number;
  windowMs?: number;
  blockMs?: number;
  maxKeys?: number;
  now?: () => number;
}

export const DEFAULT_AUTH_MAX_FAILURES = 10;
export const DEFAULT_AUTH_WINDOW_MS = 5 * 60_000;
export const DEFAULT_AUTH_BLOCK_MS = 5 * 60_000;

interface Entry {
  failures: number[];
  blockedUntil: number;
  /** Last time this key was touched; eviction drops the stalest key, not the oldest. */
  lastSeenAt: number;
}

export function createAuthFailureLimiter(
  options: AuthFailureLimiterOptions = {},
): AuthFailureLimiter {
  const maxFailures = options.maxFailures ?? DEFAULT_AUTH_MAX_FAILURES;
  const windowMs = options.windowMs ?? DEFAULT_AUTH_WINDOW_MS;
  const blockMs = options.blockMs ?? DEFAULT_AUTH_BLOCK_MS;
  const maxKeys = options.maxKeys ?? 4096;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();

  /** Frees room for `keep`, the key just inserted, which is never the victim. */
  function evictIfFull(current: number, keep: string): void {
    if (entries.size <= maxKeys) return;
    // Expired keys first: they are dead weight and never worth keeping.
    for (const [key, entry] of entries) {
      if (entries.size <= maxKeys) return;
      if (key === keep) continue;
      if (entry.blockedUntil <= current && entry.failures.every((at) => at <= current - windowMs)) {
        entries.delete(key);
      }
    }
    // Then the stalest unblocked key, and only then a blocked one: an active
    // block is worth keeping, but never at the cost of unbounded memory.
    for (const blockedToo of [false, true]) {
      while (entries.size > maxKeys) {
        let stalest: string | undefined;
        let stalestAt = Infinity;
        for (const [key, entry] of entries) {
          if (key === keep) continue;
          if (!blockedToo && entry.blockedUntil > current) continue;
          if (entry.lastSeenAt < stalestAt) {
            stalest = key;
            stalestAt = entry.lastSeenAt;
          }
        }
        if (stalest === undefined) break;
        entries.delete(stalest);
      }
    }
  }

  function entryFor(key: string, current: number): Entry {
    let entry = entries.get(key);
    if (!entry) {
      entry = { failures: [], blockedUntil: 0, lastSeenAt: current };
      entries.set(key, entry);
      evictIfFull(current, key);
    }
    entry.lastSeenAt = current;
    return entry;
  }

  return {
    isBlocked: (key) => (entries.get(key)?.blockedUntil ?? 0) > now(),
    recordFailure: (key) => {
      const current = now();
      const entry = entryFor(key, current);
      entry.failures = entry.failures.filter((at) => at > current - windowMs);
      entry.failures.push(current);
      if (entry.failures.length >= maxFailures) {
        entry.blockedUntil = current + blockMs;
        entry.failures = [];
      }
    },
    recordSuccess: (key) => {
      const entry = entries.get(key);
      if (entry && entry.blockedUntil <= now()) entries.delete(key);
    },
    retryAfterSeconds: (key) => {
      const remaining = (entries.get(key)?.blockedUntil ?? 0) - now();
      return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
    },
  };
}
