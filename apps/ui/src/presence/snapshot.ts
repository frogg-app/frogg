/**
 * COMPAT(sessionPresence): added in v1.6.0.
 *
 * Pure reduction of a presence snapshot into what the chrome renders. No React
 * and no theme in here: the rules about who counts as "someone else", when a
 * snapshot has gone stale and when the composer warns are the part worth
 * testing directly.
 */
import type {
  PresenceActivity,
  PresenceParticipant,
  PresenceSnapshot,
} from "@frogg/protocol/device-access";
import { UNTRUSTED_NAME_DISPLAY_MAX, sanitizeUntrustedText } from "@/device-access/untrusted-text";

/**
 * Mirrors `PRESENCE_ENTRY_TTL_MS` in the daemon's presence service: an entry it
 * has not heard about for this long is gone. A snapshot older than the same
 * window is shown as stale rather than as live truth.
 */
export const PRESENCE_ENTRY_TTL_MS = 90_000;

/** Clients must re-report inside the TTL; a third of it leaves room for two misses. */
export const PRESENCE_REPORT_INTERVAL_MS = 30_000;

/** Names past this many get folded into a "+N". */
export const PRESENCE_VISIBLE_LIMIT = 3;

/** Activities that mean someone is about to change this target, not just watching. */
const ACTIVE_ACTIVITIES: ReadonlySet<PresenceActivity> = new Set<PresenceActivity>([
  "typing",
  "sending",
  "input",
]);

export function isActivePresenceActivity(activity: PresenceActivity): boolean {
  return ACTIVE_ACTIVITIES.has(activity);
}

export interface PresenceOther {
  participantId: string;
  /**
   * The remote device's own name, sanitized and truncated. Empty when nothing
   * printable survived; the renderer substitutes a translated placeholder
   * rather than this module inventing English.
   */
  deviceName: string;
  /** Stable per remote app install; keys this user's nickname for it. */
  clientKey: string | null;
  activity: PresenceActivity;
  /** Epoch millis, or null when the daemon sent an unparseable timestamp. */
  activityAt: number | null;
  /** True when this entry's own timestamp has outlived the TTL. */
  isExpired: boolean;
}

export interface PresenceViewInput {
  snapshot: PresenceSnapshot | null | undefined;
  /** When the snapshot in hand arrived, from the query cache. 0 when never. */
  receivedAt: number;
  status: "idle" | "loading" | "ready" | "failed";
  now: number;
  visibleLimit?: number;
}

export type PresenceView =
  /** Nothing to draw: disabled, nobody else here, or presence itself failed. */
  | { kind: "hidden" }
  | { kind: "loading" }
  | {
      kind: "list";
      /** Everyone else, including the ones folded into the overflow count. */
      others: PresenceOther[];
      /** The ones with room for a name. */
      visible: PresenceOther[];
      overflowCount: number;
      isStale: boolean;
    };

function parseActivityAt(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toOther(participant: PresenceParticipant, now: number): PresenceOther {
  const activityAt = parseActivityAt(participant.activityAt);
  return {
    participantId: participant.participantId,
    deviceName: sanitizeUntrustedText(participant.deviceName, { max: UNTRUSTED_NAME_DISPLAY_MAX }),
    clientKey: participant.clientKey ?? null,
    activity: participant.activity,
    activityAt,
    isExpired: activityAt !== null && now - activityAt >= PRESENCE_ENTRY_TTL_MS,
  };
}

/**
 * Everyone but the recipient. `isSelf` is the daemon's marking of this
 * session's own entry, and it is the only thing that keeps a user from being
 * warned about themselves on a second device of their own.
 */
export function selectOtherParticipants(
  snapshot: PresenceSnapshot | null | undefined,
  now: number,
): PresenceOther[] {
  if (!snapshot) return [];
  return snapshot.participants
    .filter((participant) => !participant.isSelf)
    .map((participant) => toOther(participant, now));
}

/** A snapshot this old describes a state the daemon has already expired. */
export function isPresenceSnapshotStale(input: { receivedAt: number; now: number }): boolean {
  if (input.receivedAt <= 0) return true;
  return input.now - input.receivedAt >= PRESENCE_ENTRY_TTL_MS;
}

/**
 * What the presence row shows. A failed request collapses to `hidden`: presence
 * is chrome, and a chat must never look broken because of it.
 */
export function resolvePresenceView(input: PresenceViewInput): PresenceView {
  if (input.status === "idle" || input.status === "failed") {
    return { kind: "hidden" };
  }
  if (input.status === "loading" && !input.snapshot) {
    return { kind: "loading" };
  }
  const others = selectOtherParticipants(input.snapshot, input.now);
  if (others.length === 0) {
    return { kind: "hidden" };
  }
  const limit = Math.max(1, input.visibleLimit ?? PRESENCE_VISIBLE_LIMIT);
  return {
    kind: "list",
    others,
    visible: others.slice(0, limit),
    overflowCount: Math.max(0, others.length - limit),
    isStale: isPresenceSnapshotStale({ receivedAt: input.receivedAt, now: input.now }),
  };
}

export interface PresenceWarning {
  /** Sanitized; may be empty, in which case the renderer names it generically. */
  deviceName: string;
  clientKey: string | null;
  activity: PresenceActivity;
  /** How many other active participants there are beyond the named one. */
  additionalCount: number;
}

/**
 * The composer's yellow highlight. Only someone actively writing to this target
 * earns it — a second window merely watching is not worth outlining a composer
 * over — and never a stale snapshot, which would warn about someone long gone.
 */
export function selectPresenceWarning(view: PresenceView): PresenceWarning | null {
  if (view.kind !== "list" || view.isStale) return null;
  const active = view.others.filter(
    (other) => !other.isExpired && ACTIVE_ACTIVITIES.has(other.activity),
  );
  const first = active[0];
  if (!first) return null;
  return {
    deviceName: first.deviceName,
    clientKey: first.clientKey,
    activity: first.activity,
    additionalCount: active.length - 1,
  };
}
