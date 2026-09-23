import { randomInt, timingSafeEqual } from "node:crypto";

import {
  PAIRING_CODE_ALPHABET,
  PAIRING_CODE_LENGTH,
  normalizePairingCode,
  type DeviceRole,
} from "@frogg/protocol/device-access";

/**
 * Short pairing codes an owner reads out (or the CLI prints) so a device can
 * pair itself over the LAN without a QR. A code is single-use, expires, and
 * carries the role the redeeming device gets.
 *
 * Codes are only 40 bits of entropy, so redemption is throttled by the caller
 * (auth-rate-limit.ts) and the store keeps few live codes at a time.
 */
export const PAIRING_CODE_DEFAULT_TTL_SECONDS = 600;
export const PAIRING_CODE_MIN_TTL_SECONDS = 30;
export const PAIRING_CODE_MAX_TTL_SECONDS = 3600;
const DEFAULT_MAX_LIVE_CODES = 8;

export interface PairingCode {
  code: string;
  role: DeviceRole;
  expiresAt: string;
}

export interface PairingCodeStore {
  issue(input?: { role?: DeviceRole; ttlSeconds?: number }): PairingCode;
  /** Consumes the code; null when unknown, expired, or already redeemed. */
  redeem(input: string): PairingCode | null;
  liveCount(): number;
}

export function clampPairingCodeTtlSeconds(ttlSeconds: number | undefined): number {
  if (ttlSeconds === undefined || !Number.isFinite(ttlSeconds)) {
    return PAIRING_CODE_DEFAULT_TTL_SECONDS;
  }
  return Math.min(
    PAIRING_CODE_MAX_TTL_SECONDS,
    Math.max(PAIRING_CODE_MIN_TTL_SECONDS, Math.floor(ttlSeconds)),
  );
}

function generateCode(): string {
  let code = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

/** Constant-time over the live set so redemption does not leak a prefix by timing. */
function findConstantTime(live: Map<string, Entry>, candidate: string): string | null {
  const provided = Buffer.from(candidate, "utf8");
  let match: string | null = null;
  for (const code of live.keys()) {
    const expected = Buffer.from(code, "utf8");
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) match = code;
  }
  return match;
}

interface Entry {
  role: DeviceRole;
  expiresAtMs: number;
}

export function createPairingCodeStore(
  options: { maxLive?: number; now?: () => number } = {},
): PairingCodeStore {
  const maxLive = options.maxLive ?? DEFAULT_MAX_LIVE_CODES;
  const now = options.now ?? (() => Date.now());
  const live = new Map<string, Entry>();

  function prune(): void {
    const current = now();
    for (const [code, entry] of live) {
      if (entry.expiresAtMs <= current) live.delete(code);
    }
    while (live.size > maxLive) {
      const oldest = live.keys().next().value;
      if (oldest === undefined) break;
      live.delete(oldest);
    }
  }

  return {
    issue: (input = {}) => {
      prune();
      const role = input.role ?? "operator";
      const expiresAtMs = now() + clampPairingCodeTtlSeconds(input.ttlSeconds) * 1000;
      let code = generateCode();
      while (live.has(code)) code = generateCode();
      live.set(code, { role, expiresAtMs });
      prune();
      return { code, role, expiresAt: new Date(expiresAtMs).toISOString() };
    },
    redeem: (input) => {
      prune();
      const normalized = normalizePairingCode(input);
      if (!normalized) return null;
      const code = findConstantTime(live, normalized);
      if (!code) return null;
      const entry = live.get(code)!;
      live.delete(code);
      if (entry.expiresAtMs <= now()) return null;
      return { code, role: entry.role, expiresAt: new Date(entry.expiresAtMs).toISOString() };
    },
    liveCount: () => {
      prune();
      return live.size;
    },
  };
}
