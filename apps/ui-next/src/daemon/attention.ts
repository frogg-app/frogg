// Marks a finished or failed session as seen. The daemon raises `requiresAttention` when a turn
// ends and keeps it until a client clears it; that flag is what files a session under "Ready to
// review" in the list, Inbox and rail counts. Ported from apps/ui's use-agent-attention-clear:
// clear when the session is open in a visible, focused window, when the user types, and on send.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getClient } from "./store";
import { bucketOf, type Agent } from "./types";

type Clearable = Pick<
  Agent,
  "id" | "requiresAttention" | "attentionReason" | "attentionTimestamp" | "pendingPermissions"
>;

/**
 * One key per raised flag (agent + when it was raised), or null when there is nothing this app
 * may clear. A permission request is answered, not marked read, so it is never cleared here.
 */
export function attentionKey(a: Clearable): string | null {
  if (!a.requiresAttention) return null;
  if (a.attentionReason === "permission" || a.pendingPermissions.length > 0) return null;
  return `${a.id}|${a.attentionTimestamp ?? ""}`;
}

/** Keys with a clear in flight: one request per raised flag, however often we re-render. */
const sent = new Set<string>();

export function resetAttentionClears(): void {
  sent.clear();
}

type ClearFn = (agentId: string) => Promise<unknown>;

const daemonClear: ClearFn = (id) =>
  getClient()?.clearAgentAttention(id) ?? Promise.reject(new Error("offline"));

/**
 * Clears this flag once while the request is in flight. Returns whether a request went out. The
 * daemon pushes the cleared state before it answers, so the key is forgotten once settled: a
 * failure retries on the next trigger.
 */
export function clearAttention(a: Clearable, clear: ClearFn = daemonClear): boolean {
  const key = attentionKey(a);
  if (!key || sent.has(key)) return false;
  sent.add(key);
  const settle = () => {
    sent.delete(key);
  };
  clear(a.id).then(settle, settle);
  return true;
}

function windowActive(): boolean {
  const d = (globalThis as { document?: Document }).document;
  if (d) return d.visibilityState !== "hidden" && (d.hasFocus?.() ?? true);
  return AppState.currentState === "active";
}

/** True while the app is on screen and focused (web: visible tab + focused window). */
export function useWindowActive(): boolean {
  const [active, setActive] = useState(windowActive);
  useEffect(() => {
    const update = () => setActive(windowActive());
    const sub = AppState.addEventListener("change", update);
    const w = globalThis as { document?: Document; addEventListener?: Window["addEventListener"] };
    const doc = w.document;
    if (doc && w.addEventListener) {
      doc.addEventListener("visibilitychange", update);
      window.addEventListener("focus", update);
      window.addEventListener("blur", update);
    }
    update();
    return () => {
      sub.remove();
      if (doc && w.addEventListener) {
        doc.removeEventListener("visibilitychange", update);
        window.removeEventListener("focus", update);
        window.removeEventListener("blur", update);
      }
    };
  }, []);
  return active;
}

/**
 * Clears the session's attention while it is open in an active window (on open, on coming back
 * to the window, and when a turn finishes in front of the user). Returns a clear for explicit
 * interactions (typing, send) that applies even when the window check is unsure.
 */
export function useAttentionClear(agent: Agent, online: boolean): () => void {
  const active = useWindowActive();
  const key = attentionKey(agent);
  useEffect(() => {
    if (online && active && key) clearAttention(agent);
    // `key` captures every field of `agent` the clear reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, active, key]);
  // Stable across agent updates, so handlers built on it do not re-fire.
  const latest = useRef(agent);
  latest.current = agent;
  return useCallback(() => {
    if (online) clearAttention(latest.current);
  }, [online]);
}

/**
 * What the end-of-turn card is holding: the flag it showed for, and the flag the user has
 * moved past. Clearing the flag does not drop the card; the outcome stays in the conversation
 * until the user types, sends or leaves, then folds away.
 */
export interface FinishHold {
  key: string | null;
  dismissed: string | null;
}

export const NO_HOLD: FinishHold = { key: null, dismissed: null };

/** Picks up a newly raised finish; same object when nothing changed (render-safe). */
export function holdFinish(h: FinishHold, a: Agent): FinishHold {
  if (bucketOf(a) !== "review") return h;
  const key = attentionKey(a);
  return key && key !== h.key ? { key, dismissed: h.dismissed } : h;
}

/** Whether the "Ready to review"/"Finished" card shows for `a`. */
export function showsFinish(h: FinishHold, a: Agent): boolean {
  const b = bucketOf(a);
  if (b !== "review" && b !== "idle") return false;
  if (!h.key || h.key === h.dismissed || !h.key.startsWith(`${a.id}|`)) return false;
  return true;
}

/** The user moved past the card: fold it until the next finish. */
export function dismissFinish(h: FinishHold): FinishHold {
  return h.key && h.dismissed !== h.key ? { key: h.key, dismissed: h.key } : h;
}
