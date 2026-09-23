/**
 * COMPAT(sessionPresence): added in v1.6.0. The composer's half of presence:
 * it reports `typing` while there is text in the box, and reads back whoever
 * else is active on the same agent so the input can outline itself in amber.
 */
import type { PresenceWarning } from "@/presence/snapshot";
import { usePresence } from "@/presence/use-presence";

export function useComposerPresenceWarning(input: {
  serverId: string;
  agentId: string | null | undefined;
  /** True once the user has typed something worth telling the others about. */
  isComposing: boolean;
}): PresenceWarning | null {
  const { warning } = usePresence({
    serverId: input.serverId,
    targetKind: "agent",
    targetId: input.agentId,
    isTyping: input.isComposing,
  });
  return warning;
}
