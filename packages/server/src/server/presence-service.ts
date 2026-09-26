import type {
  PresenceActivity,
  PresenceParticipant,
  PresenceReportState,
  PresenceSnapshot,
  PresenceTarget,
} from "@frogg/protocol/device-access";

/**
 * Who is looking at an agent or a terminal right now, daemon-wide.
 *
 * Clients report `viewing` / `typing` / `idle` / `left` for a target and
 * re-report while they stay; the daemon adds the activities it can see itself
 * (`sending` a message, terminal `input`). Entries expire, so a client that
 * disappears without saying `left` stops showing up for everyone else.
 */

export const PRESENCE_ENTRY_TTL_MS = 90_000;
/** How long a daemon-observed `sending` / `input` outranks the client's own state. */
export const PRESENCE_DERIVED_ACTIVITY_MS = 6_000;

export interface PresenceIdentity {
  /** Stable for the life of a connection. */
  participantId: string;
  deviceId: string | null;
  deviceName: string;
  clientType: string | null;
  /** Hash of the client install id; see `PresenceParticipant.clientKey`. */
  clientKey?: string;
}

interface Entry extends PresenceIdentity {
  reported: PresenceActivity;
  reportedAtMs: number;
  derived: PresenceActivity | null;
  derivedAtMs: number;
  expiresAtMs: number;
}

export interface PresenceService {
  report(identity: PresenceIdentity, target: PresenceTarget, state: PresenceReportState): void;
  /** An activity the daemon saw rather than one the client claimed. */
  noteActivity(
    identity: PresenceIdentity,
    target: PresenceTarget,
    activity: PresenceActivity,
  ): void;
  /** Drops every entry for a connection (disconnect, revocation). */
  leaveAll(participantId: string): void;
  snapshot(target: PresenceTarget, selfParticipantId: string | null): PresenceSnapshot;
  /** Every live target a connection has presence on. */
  targetsFor(participantId: string): PresenceTarget[];
  subscribe(listener: (target: PresenceTarget) => void): () => void;
}

export function presenceTargetKey(target: PresenceTarget): string {
  return target.kind === "agent" ? `agent:${target.agentId}` : `terminal:${target.terminalId}`;
}

function parseTargetKey(key: string): PresenceTarget {
  const [kind, ...rest] = key.split(":");
  const id = rest.join(":");
  return kind === "agent" ? { kind: "agent", agentId: id } : { kind: "terminal", terminalId: id };
}

export function createPresenceService(
  options: { ttlMs?: number; now?: () => number } = {},
): PresenceService {
  const ttlMs = options.ttlMs ?? PRESENCE_ENTRY_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const targets = new Map<string, Map<string, Entry>>();
  const listeners = new Set<(target: PresenceTarget) => void>();

  function prune(key: string): boolean {
    const entries = targets.get(key);
    if (!entries) return false;
    const current = now();
    let changed = false;
    for (const [participantId, entry] of entries) {
      if (entry.expiresAtMs <= current) {
        entries.delete(participantId);
        changed = true;
      }
    }
    if (entries.size === 0) targets.delete(key);
    return changed;
  }

  function notify(key: string): void {
    const target = parseTargetKey(key);
    for (const listener of listeners) listener(target);
  }

  function upsert(
    identity: PresenceIdentity,
    target: PresenceTarget,
    update: (entry: Entry, current: number) => Entry | null,
  ): void {
    const key = presenceTargetKey(target);
    prune(key);
    const current = now();
    const entries = targets.get(key) ?? new Map<string, Entry>();
    const existing = entries.get(identity.participantId) ?? null;
    const base: Entry = {
      ...(existing ?? {
        reported: "viewing" as PresenceActivity,
        reportedAtMs: current,
        derived: null,
        derivedAtMs: 0,
        expiresAtMs: current + ttlMs,
      }),
      ...identity,
    };
    const next = update(base, current);
    if (next === null) {
      if (!existing) return;
      entries.delete(identity.participantId);
      if (entries.size === 0) targets.delete(key);
      notify(key);
      return;
    }
    entries.set(identity.participantId, next);
    targets.set(key, entries);
    // A re-report that changes nothing visible still renews the lease, but
    // there is no reason to wake every other client for it.
    const changed =
      !existing ||
      existing.deviceName !== next.deviceName ||
      visibleActivity(existing, current) !== visibleActivity(next, current);
    if (changed) notify(key);
  }

  function visibleActivity(entry: Entry, current: number): PresenceActivity {
    if (entry.derived && current - entry.derivedAtMs < PRESENCE_DERIVED_ACTIVITY_MS) {
      return entry.derived;
    }
    return entry.reported;
  }

  return {
    report(identity, target, state) {
      if (state === "left") {
        upsert(identity, target, () => null);
        return;
      }
      upsert(identity, target, (entry, current) => ({
        ...entry,
        reported: state,
        reportedAtMs: current,
        expiresAtMs: current + ttlMs,
      }));
    },

    noteActivity(identity, target, activity) {
      upsert(identity, target, (entry, current) => ({
        ...entry,
        derived: activity,
        derivedAtMs: current,
        expiresAtMs: current + ttlMs,
      }));
    },

    leaveAll(participantId) {
      // Deleting the current key mid-iteration is well defined for a Map.
      for (const [key, entries] of targets) {
        if (!entries.delete(participantId)) continue;
        if (entries.size === 0) targets.delete(key);
        notify(key);
      }
    },

    snapshot(target, selfParticipantId) {
      const key = presenceTargetKey(target);
      prune(key);
      const current = now();
      const entries = targets.get(key);
      const participants: PresenceParticipant[] = [...(entries?.values() ?? [])].map((entry) => ({
        participantId: entry.participantId,
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
        clientType: entry.clientType,
        clientKey: entry.clientKey,
        activity: visibleActivity(entry, current),
        activityAt: new Date(Math.max(entry.reportedAtMs, entry.derivedAtMs)).toISOString(),
        isSelf: entry.participantId === selfParticipantId,
      }));
      participants.sort((left, right) => left.deviceName.localeCompare(right.deviceName));
      return { target, participants };
    },

    targetsFor(participantId) {
      const result: PresenceTarget[] = [];
      for (const key of targets.keys()) {
        prune(key);
        if (targets.get(key)?.has(participantId)) result.push(parseTargetKey(key));
      }
      return result;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
