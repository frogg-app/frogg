/**
 * COMPAT(sessionPresence): added in v1.6.0.
 *
 * Presence targets identify what a participant is looking at. They are passed
 * around the client as two flat strings rather than the wire object so that a
 * component prop cannot be a fresh object literal on every render, and are
 * rebuilt into the wire shape at the edge that talks to the daemon.
 */
import type { PresenceTarget } from "@frogg/protocol/device-access";

export type PresenceTargetKind = PresenceTarget["kind"];

/** The opaque id inside a target, whichever branch it is. */
export function presenceTargetId(target: PresenceTarget): string {
  return target.kind === "agent" ? target.agentId : target.terminalId;
}

/** Stable key for cache keys, subscription filtering and reporter refcounts. */
export function presenceTargetKey(target: PresenceTarget): string {
  return `${target.kind}:${presenceTargetId(target)}`;
}

/**
 * Builds a target from the flat pair a component holds. Returns null for an
 * empty id so callers can treat "no target yet" as "report nothing".
 */
export function buildPresenceTarget(
  kind: PresenceTargetKind,
  id: string | null | undefined,
): PresenceTarget | null {
  const trimmed = id?.trim() ?? "";
  if (trimmed.length === 0) return null;
  return kind === "agent" ? { kind, agentId: trimmed } : { kind, terminalId: trimmed };
}

export function isSamePresenceTarget(a: PresenceTarget, b: PresenceTarget): boolean {
  return presenceTargetKey(a) === presenceTargetKey(b);
}
