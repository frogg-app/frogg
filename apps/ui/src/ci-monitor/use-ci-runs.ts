import { useEffect, useMemo, useState } from "react";
import { useFetchQuery } from "@/data/query";
import { useTranslation } from "react-i18next";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { isCiActive, normalizeCiRun, type CiRun } from "./model";

/** Close enough to watch a job land without hammering GitHub's rate limit or Jenkins. */
const ACTIVE_POLL_MS = 10_000;
/** Nothing running: still notice a new push, just not eagerly. */
const IDLE_POLL_MS = 60_000;

export function ciRunsQueryKey(serverId: string, cwd: string) {
  return ["ci-runs", serverId, cwd] as const;
}

export interface CiRunsState {
  supported: boolean;
  runs: CiRun[];
  branch: string | null;
  providers: string[];
  providerErrors: Array<{ provider: string; message: string }>;
  error: string | null;
  isLoading: boolean;
  isFetching: boolean;
  refetch: () => void;
}

export function useCiRuns(input: { serverId: string; cwd: string; enabled: boolean }): CiRunsState {
  const { serverId, cwd, enabled } = input;
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.ciRuns === true,
  );

  const query = useFetchQuery({
    queryKey: ciRunsQueryKey(serverId, cwd),
    dataShape: "value",
    // Polling below is what keeps this fresh; a remount should not refetch on top of it.
    staleTimeMs: ACTIVE_POLL_MS,
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return client.checkoutCiListRuns(cwd);
    },
    enabled: supported && enabled && !!client && isConnected && !!cwd,
    refetchInterval: (current) =>
      current.state.data?.runs.some((run) => isCiActive(run.status as CiRun["status"]))
        ? ACTIVE_POLL_MS
        : IDLE_POLL_MS,
    refetchOnWindowFocus: false,
  });

  const runs = useMemo(() => (query.data?.runs ?? []).map(normalizeCiRun), [query.data]);
  return {
    supported,
    runs,
    branch: query.data?.branch ?? null,
    providers: query.data?.providers ?? [],
    providerErrors: query.data?.providerErrors ?? [],
    error: query.data?.error?.message ?? describeError(query.error),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}

function describeError(error: unknown): string | null {
  if (!error) return null;
  return error instanceof Error ? error.message : String(error);
}

/**
 * The pane's clock: every second while something runs, for live durations; otherwise every
 * half minute, which is all the "started 2h ago" labels need.
 */
export function useCiNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), active ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
