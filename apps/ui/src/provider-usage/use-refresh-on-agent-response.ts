import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/session-store";

/**
 * Refreshes usage the moment an agent stops running. A turn is the only thing
 * that actually moves these numbers, so its end is the one event worth a
 * request — watching the status rather than the timeline keeps this to a single
 * store subscription per composer.
 */
export function useRefreshUsageOnAgentResponse(input: {
  serverId: string;
  agentId: string | null | undefined;
  enabled: boolean;
  refresh: () => Promise<void>;
}): void {
  const { serverId, agentId, enabled, refresh } = input;
  const status = useSessionStore((state) =>
    agentId ? (state.sessions[serverId]?.agents?.get(agentId)?.status ?? null) : null,
  );
  const previousStatus = useRef<string | null>(status);

  useEffect(() => {
    const wasRunning = previousStatus.current === "running";
    previousStatus.current = status;
    if (!enabled || !wasRunning || status === "running") return;
    void refresh().catch(() => {});
  }, [enabled, refresh, status]);
}
