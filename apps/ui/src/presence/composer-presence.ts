/**
 * COMPAT(sessionPresence): added in v1.6.0. The composer's half of presence:
 * it reports `typing` while the user is editing the text, and reads back
 * whoever else is active on the same agent so the input can mark itself shared.
 */
import { useEffect, useRef, useState } from "react";
import type { PresenceWarning } from "@/presence/snapshot";
import { usePresence } from "@/presence/use-presence";

/** How long after the last edit the user still counts as typing. */
export const TYPING_IDLE_MS = 5_000;

/**
 * True while the text is being changed. Text that just sits in the box is not
 * typing, and clearing it (sending, or deleting everything) ends it at once.
 */
export function useIsEditing(text: string, idleMs: number = TYPING_IDLE_MS): boolean {
  const [isEditing, setIsEditing] = useState(false);
  const previous = useRef(text);
  useEffect(() => {
    if (previous.current === text) return;
    previous.current = text;
    if (text.trim().length === 0) {
      setIsEditing(false);
      return;
    }
    setIsEditing(true);
    const timer = setTimeout(() => setIsEditing(false), idleMs);
    return () => clearTimeout(timer);
  }, [idleMs, text]);
  return isEditing;
}

export function useComposerPresenceWarning(input: {
  serverId: string;
  agentId: string | null | undefined;
  /** The composer's current text; only edits to it count as typing. */
  text: string;
}): PresenceWarning | null {
  const isTyping = useIsEditing(input.text);
  const { warning } = usePresence({
    serverId: input.serverId,
    targetKind: "agent",
    targetId: input.agentId,
    isTyping,
  });
  return warning;
}
