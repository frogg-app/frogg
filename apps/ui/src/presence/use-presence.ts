/**
 * COMPAT(sessionPresence): added in v1.6.0.
 *
 * React binding for session presence. Everything here is gated on
 * `features.sessionPresence`: when the daemon does not advertise it, no query
 * runs, no subscription is opened and no RPC is ever put on the wire.
 *
 * Reporting and subscribing are the same act. The daemon only pushes
 * `presence.update` for targets this session has reported on, so the narrow
 * typed `client.on("presence.update", …)` listener here sees only the targets
 * this app asked about, and still filters by target key because one daemon can
 * be feeding several open panels.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { PresenceSnapshot } from "@frogg/protocol/device-access";
import { useReplicaQuery } from "@/data/query";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  PRESENCE_ENTRY_TTL_MS,
  resolvePresenceView,
  selectPresenceWarning,
  type PresenceView,
  type PresenceWarning,
} from "@/presence/snapshot";
import {
  presenceReporterRegistry,
  type PresenceMemberState,
  type PresenceReporterHandle,
} from "@/presence/reporter";
import { buildPresenceTarget, presenceTargetKey, type PresenceTargetKind } from "@/presence/target";

/** Re-evaluates staleness often enough to notice the TTL lapsing, and no more. */
const PRESENCE_CLOCK_INTERVAL_MS = PRESENCE_ENTRY_TTL_MS / 3;

export function presenceQueryKey(serverId: string, targetKey: string): readonly unknown[] {
  return ["presence", serverId, targetKey];
}

interface UsePresenceInput {
  serverId: string;
  targetKind: PresenceTargetKind;
  targetId: string | null | undefined;
  /**
   * False for a retained panel that is mounted but not on screen. A hidden
   * panel stops reporting so its user does not appear to be watching something
   * they cannot see, and resumes when it is shown again.
   */
  isVisible?: boolean;
  /** True while the user is composing into this target. */
  isTyping?: boolean;
}

export interface PresenceResult {
  view: PresenceView;
  warning: PresenceWarning | null;
}

const HIDDEN_RESULT: PresenceResult = { view: { kind: "hidden" }, warning: null };

/** A clock that only ticks while presence is actually on screen. */
function usePresenceNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), PRESENCE_CLOCK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return now;
}

export function usePresence(input: UsePresenceInput): PresenceResult {
  const { serverId, targetKind, targetId, isTyping = false } = input;
  const retainedActive = useRetainedPanelActive();
  const isVisible = (input.isVisible ?? true) && retainedActive;
  const supportsPresence = useHostFeature(serverId, "sessionPresence");
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const queryClient = useQueryClient();

  const target = useMemo(() => buildPresenceTarget(targetKind, targetId), [targetKind, targetId]);
  const targetKey = target ? presenceTargetKey(target) : "";
  const enabled = supportsPresence && target !== null && client !== null;
  const queryKey = useMemo(() => presenceQueryKey(serverId, targetKey), [serverId, targetKey]);

  const query = useReplicaQuery<PresenceSnapshot>({
    queryKey,
    enabled: enabled && isVisible,
    pushEvent: "presence.update",
    // Presence is chrome. One failed request is reported as "no presence", not
    // retried into a storm against a daemon that is already saying no.
    retry: false,
    queryFn: async () => {
      if (!client || !target) {
        throw new Error("Presence is unavailable for this target.");
      }
      const payload = await client.getPresence(target);
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload.snapshot;
    },
  });

  // Narrow subscription: the daemon pushes only for reported targets, and the
  // key check keeps one panel's update out of another's cache entry.
  useEffect(() => {
    if (!enabled || !client || !target || !isVisible) return;
    const key = presenceTargetKey(target);
    return client.on("presence.update", (message) => {
      const snapshot = message.payload;
      if (presenceTargetKey(snapshot.target) !== key) return;
      queryClient.setQueryData<PresenceSnapshot>(queryKey, snapshot);
    });
  }, [client, enabled, isVisible, queryClient, queryKey, target]);

  usePresenceReporting({
    serverId,
    target,
    client,
    enabled,
    isConnected,
    queryClient,
    queryKey,
    memberState: resolveMemberState({ isVisible, isTyping }),
  });

  const hasData = query.data !== undefined;
  const now = usePresenceNow(enabled && isVisible && hasData);
  const status = resolveQueryStatus({ enabled: enabled && isVisible, query });

  return useMemo(() => {
    if (!enabled || !isVisible) return HIDDEN_RESULT;
    const view = resolvePresenceView({
      snapshot: query.data ?? null,
      receivedAt: query.dataUpdatedAt,
      status,
      now,
    });
    return { view, warning: selectPresenceWarning(view) };
  }, [enabled, isVisible, now, query.data, query.dataUpdatedAt, status]);
}

function resolveMemberState(input: { isVisible: boolean; isTyping: boolean }): PresenceMemberState {
  if (!input.isVisible) return null;
  return input.isTyping ? "typing" : "viewing";
}

function resolveQueryStatus(input: {
  enabled: boolean;
  query: { isError: boolean; data: PresenceSnapshot | undefined };
}): "idle" | "loading" | "ready" | "failed" {
  if (!input.enabled) return "idle";
  if (input.query.isError && input.query.data === undefined) return "failed";
  if (input.query.data === undefined) return "loading";
  return "ready";
}

interface UsePresenceReportingInput {
  serverId: string;
  target: ReturnType<typeof buildPresenceTarget>;
  client: ReturnType<typeof useHostRuntimeClient>;
  enabled: boolean;
  isConnected: boolean;
  queryClient: ReturnType<typeof useQueryClient>;
  queryKey: readonly unknown[];
  memberState: PresenceMemberState;
}

function usePresenceReporting(input: UsePresenceReportingInput): void {
  const { serverId, target, client, enabled, isConnected, queryClient, queryKey, memberState } =
    input;
  const handleRef = useRef<PresenceReporterHandle | null>(null);
  const memberStateRef = useRef(memberState);
  memberStateRef.current = memberState;

  useEffect(() => {
    if (!enabled || !client || !target) {
      handleRef.current = null;
      return;
    }
    const handle = presenceReporterRegistry.acquire({
      serverId,
      target,
      transport: client,
    });
    handleRef.current = handle;
    // Re-acquiring (a reconnect handing over a new client) must not lose what
    // this surface was claiming, so the handle is seeded here rather than
    // waiting for the next change of `memberState`.
    handle.setState(memberStateRef.current);
    return () => {
      handleRef.current = null;
      handle.release();
    };
  }, [client, enabled, serverId, target]);

  useEffect(() => {
    handleRef.current?.setState(memberState);
  }, [memberState]);

  // The daemon drops every reported target with the session, so a reconnect
  // re-reports and refetches rather than waiting out the heartbeat. This
  // mirrors the client's own `resubscribe*` pass on HELLO_SERVER_INFO.
  const wasConnected = useRef(isConnected);
  useEffect(() => {
    const reconnected = isConnected && !wasConnected.current;
    wasConnected.current = isConnected;
    if (!reconnected || !enabled) return;
    presenceReporterRegistry.handleReconnect(serverId);
    void queryClient.invalidateQueries({ queryKey });
  }, [enabled, isConnected, queryClient, queryKey, serverId]);
}
