import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

import {
  PAIRING_CODE_ALPHABET,
  type DeviceRole,
  type PendingPairingRequest,
} from "@frogg/protocol/device-access";

/**
 * Owner approval: a device that reaches an already-claimed daemon asks to be
 * let in, and an owner approves or denies it from a paired client. The
 * requesting device polls with a secret `pollId` it alone knows; the owner
 * matches the request by the short `matchCode` shown on both screens.
 */
export const PAIRING_REQUEST_TTL_MS = 5 * 60_000;
const MATCH_CODE_LENGTH = 4;
const DEFAULT_MAX_PENDING = 8;

export type PairingRequestState =
  | { status: "pending"; expiresAt: string }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "approved"; role: DeviceRole; name: string };

export interface PairingRequestRecord extends PendingPairingRequest {
  pollId: string;
}

export interface PairingRequestStore {
  create(input: { deviceName: string; remoteAddress: string | null }): PairingRequestRecord | null;
  list(): PendingPairingRequest[];
  /** Resolves a request by its id (what the owner sees). */
  decide(input: {
    id: string;
    decision: "approve" | "deny";
    role?: DeviceRole;
    name?: string;
  }): PairingRequestRecord | null;
  /** Poll by the requesting device's secret. Consumes an approval or a denial. */
  poll(pollId: string): PairingRequestState | null;
  onChange(listener: () => void): () => void;
}

interface Entry {
  record: PairingRequestRecord;
  expiresAtMs: number;
  outcome: PairingRequestState | null;
}

function generateMatchCode(): string {
  let code = "";
  for (let index = 0; index < MATCH_CODE_LENGTH; index += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

function findPollId(entries: Map<string, Entry>, candidate: string): string | null {
  const provided = Buffer.from(candidate, "utf8");
  let match: string | null = null;
  for (const pollId of entries.keys()) {
    const expected = Buffer.from(pollId, "utf8");
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) match = pollId;
  }
  return match;
}

export function createPairingRequestStore(
  options: { ttlMs?: number; maxPending?: number; now?: () => number } = {},
): PairingRequestStore {
  const ttlMs = options.ttlMs ?? PAIRING_REQUEST_TTL_MS;
  const maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function prune(): void {
    const current = now();
    for (const [pollId, entry] of entries) {
      // A resolved request is kept until its poller collects it, but never past
      // its expiry, so an abandoned approval cannot be redeemed hours later.
      if (entry.expiresAtMs <= current) entries.delete(pollId);
    }
  }

  function pendingEntries(): Entry[] {
    prune();
    return [...entries.values()].filter((entry) => entry.outcome === null);
  }

  return {
    create: ({ deviceName, remoteAddress }) => {
      prune();
      if (pendingEntries().length >= maxPending) return null;
      const createdAtMs = now();
      const expiresAtMs = createdAtMs + ttlMs;
      const record: PairingRequestRecord = {
        id: `pr_${randomBytes(9).toString("base64url")}`,
        pollId: randomBytes(32).toString("base64url"),
        deviceName,
        matchCode: generateMatchCode(),
        remoteAddress,
        createdAt: new Date(createdAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
      entries.set(record.pollId, { record, expiresAtMs, outcome: null });
      notify();
      return record;
    },
    list: () =>
      pendingEntries().map(({ record }) => ({
        id: record.id,
        deviceName: record.deviceName,
        matchCode: record.matchCode,
        remoteAddress: record.remoteAddress,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
      })),
    decide: ({ id, decision, role, name }) => {
      const entry = pendingEntries().find(({ record }) => record.id === id);
      if (!entry) return null;
      entry.outcome =
        decision === "approve"
          ? { status: "approved", role: role ?? "operator", name: name ?? entry.record.deviceName }
          : { status: "denied" };
      notify();
      return entry.record;
    },
    poll: (pollId) => {
      prune();
      const key = findPollId(entries, pollId);
      if (!key) return null;
      const entry = entries.get(key)!;
      if (entry.outcome === null) return { status: "pending", expiresAt: entry.record.expiresAt };
      // Outcomes are collected exactly once.
      entries.delete(key);
      if (entry.outcome.status !== "denied") notify();
      return entry.outcome;
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
