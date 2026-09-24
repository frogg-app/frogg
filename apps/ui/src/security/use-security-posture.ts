import { useCallback, useMemo, useState } from "react";
import { useShallow } from "zustand/shallow";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { readSecurityPosture, type SecurityPostureView, type SecuritySeverity } from "./posture";

function useSecurityInputs(serverId: string) {
  return useSessionStore(
    useShallow((state) => {
      const info = state.sessions[serverId]?.serverInfo;
      return {
        securityPosture: info?.features?.securityPosture === true,
        callerRole: info?.callerRole,
        security: info?.security,
      };
    }),
  );
}

export function useSecurityPosture(serverId: string): SecurityPostureView {
  const inputs = useSecurityInputs(serverId);
  return useMemo(
    () =>
      readSecurityPosture({
        features: { securityPosture: inputs.securityPosture },
        ...(inputs.callerRole ? { callerRole: inputs.callerRole } : {}),
        ...(inputs.security ? { security: inputs.security } : {}),
      }),
    [inputs.callerRole, inputs.securityPosture, inputs.security],
  );
}

/** Worst severity for one host — the narrow selector the notification dots use. */
export function useSecuritySeverity(serverId: string): SecuritySeverity | null {
  return useSecurityPosture(serverId).severity;
}

/** Worst severity across several hosts, for an entry that stands for all of them. */
export function useWorstSecuritySeverity(serverIds: readonly string[]): SecuritySeverity | null {
  return useSessionStore((state) => {
    let worst: SecuritySeverity | null = null;
    for (const serverId of serverIds) {
      const severity = readSecurityPosture(state.sessions[serverId]?.serverInfo).severity;
      if (severity === "critical") return "critical";
      if (severity) worst = severity;
    }
    return worst;
  });
}

/**
 * Re-reads the posture from the daemon. A first claim through a pairing code
 * or request does not re-send `server_info`, so surfaces that can follow a
 * pairing call this rather than trusting the handshake copy.
 */
export function useRefreshSecurityPosture(serverId: string): {
  refresh: () => Promise<void>;
  isRefreshing: boolean;
} {
  const client = useHostRuntimeClient(serverId);
  const setPosture = useSessionStore((state) => state.setSessionSecurityPosture);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    if (!client) return;
    setIsRefreshing(true);
    try {
      const payload = await client.getDaemonSecurityPosture();
      if (payload.posture) setPosture(serverId, payload.posture);
    } catch (error) {
      // The handshake copy stays; a failed refresh is not worth an error state of its own.
      console.warn("[security] posture refresh failed", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [client, serverId, setPosture]);
  return { refresh, isRefreshing };
}
