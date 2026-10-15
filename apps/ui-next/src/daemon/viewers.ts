// Who else has a session open: the daemon's session presence (features.sessionPresence, v1.6.0+),
// the same data the classic app's presence bar reads. Reporting is also what subscribes: the
// daemon pushes `presence.update` only for targets this connection has reported on. An older
// daemon, or one refusing presence, simply shows nobody; nothing here throws or toasts.
import type { PresenceParticipant, PresenceSnapshot } from "@frogg/protocol/device-access";
import { useEffect, useMemo, useState } from "react";
import { getClient, useDaemon } from "./store";

/** Mirrors the daemon's entry TTL: an entry not heard from for this long is gone. */
export const VIEWER_TTL_MS = 90_000;
/** Re-report inside the TTL, leaving room for two misses. */
const REPORT_MS = 30_000;
/** Consecutive refusals before the heartbeat stops until something changes. */
const MAX_FAILURES = 3;

export type ViewerState = "viewing" | "typing";

export interface Viewer {
  id: string;
  name: string;
  /** Stable per remote install; keys its avatar colour. */
  key: string;
  clientType: string | null;
  activity: PresenceParticipant["activity"];
}

export function supportsPresence(): boolean {
  const info = getClient()?.getLastServerInfoMessage() as {
    features?: { sessionPresence?: boolean };
  } | null;
  return !!info?.features?.sessionPresence;
}

/** Control characters out, whitespace folded, capped: device names come from other clients. */
export function cleanName(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 32 || (c >= 127 && c < 160) ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 40);
}

/** Everyone in a snapshot but this connection, freshest first, expired entries dropped. */
export function othersIn(snapshot: PresenceSnapshot | null, now: number): Viewer[] {
  if (!snapshot) return [];
  return snapshot.participants
    .filter((p) => !p.isSelf)
    .filter((p) => {
      const at = Date.parse(p.activityAt);
      return Number.isNaN(at) || now - at < VIEWER_TTL_MS;
    })
    .map((p) => ({
      id: p.participantId,
      name: cleanName(p.deviceName) || "Another device",
      key: p.clientKey ?? p.participantId,
      clientType: p.clientType,
      activity: p.activity,
    }));
}

export const isActive = (v: Viewer) =>
  v.activity === "typing" || v.activity === "sending" || v.activity === "input";

/**
 * Reports this app as viewing (or typing in) `agentId` while mounted and returns everyone else
 * there. Re-reports and refetches when the host comes back, since the daemon forgets every
 * reported target with the connection.
 */
export function useViewers(agentId: string, state: ViewerState): Viewer[] {
  const online = useDaemon((s) => s.conn === "online");
  const [snapshot, setSnapshot] = useState<PresenceSnapshot | null>(null);
  const [now, setNow] = useState(Date.now);
  const client = online ? getClient() : null;
  const enabled = !!client && supportsPresence();

  // Snapshot + live pushes for this target.
  useEffect(() => {
    setSnapshot(null);
    if (!enabled || !client) return undefined;
    let live = true;
    const unsub = client.subscribeRawMessages((m) => {
      if (m.type !== "presence.update") return;
      const t = m.payload.target;
      if (t.kind === "agent" && t.agentId === agentId) setSnapshot(m.payload);
    });
    void client
      .getPresence({ kind: "agent", agentId })
      .then((r) => {
        if (live && !r.error) setSnapshot(r.snapshot);
        return r;
      })
      .catch(() => undefined);
    return () => {
      live = false;
      unsub();
    };
  }, [enabled, client, agentId]);

  // Heartbeat: report now, then inside the TTL; a host that keeps refusing is left alone until
  // the state or the connection changes. `left` goes out when this chat closes.
  useEffect(() => {
    if (!enabled || !client) return undefined;
    const target = { kind: "agent" as const, agentId };
    let failures = 0;
    const report = () => {
      if (failures >= MAX_FAILURES) return;
      void client
        .reportPresence({ target, state })
        .then((r) => {
          failures = r.error ? failures + 1 : 0;
          return r;
        })
        .catch(() => {
          failures += 1;
        });
    };
    report();
    const id = setInterval(report, REPORT_MS);
    return () => clearInterval(id);
  }, [enabled, client, agentId, state]);
  useEffect(() => {
    if (!enabled || !client) return undefined;
    return () => {
      void client
        .reportPresence({ target: { kind: "agent", agentId }, state: "left" })
        .catch(() => undefined);
    };
  }, [enabled, client, agentId]);

  // A clock so a peer that silently vanished drops off once its entry outlives the TTL.
  const any = !!snapshot?.participants.some((p) => !p.isSelf);
  useEffect(() => {
    if (!any) return undefined;
    const id = setInterval(() => setNow(Date.now()), VIEWER_TTL_MS / 3);
    return () => clearInterval(id);
  }, [any]);

  return useMemo(() => (enabled ? othersIn(snapshot, now) : []), [enabled, snapshot, now]);
}
