import { useTranslation } from "react-i18next";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { StreamsGraphPayload } from "./model";

/** Streams move when someone pushes or releases; a few minutes is fresh enough. */
const POLL_MS = 3 * 60_000;

export interface ReleaseStreamsState {
  supported: boolean;
  data: StreamsGraphPayload | null;
  error: string | null;
  isLoading: boolean;
  isFetching: boolean;
  /** Fetch origin and upstream (the daemon throttles this to once a minute) and re-read. */
  refetch: () => void;
}

export function releaseStreamsQueryKey(serverId: string, cwd: string) {
  return ["release-streams", serverId, cwd] as const;
}

export function useReleaseStreams(input: {
  serverId: string;
  cwd: string;
  enabled: boolean;
}): ReleaseStreamsState {
  const { serverId, cwd, enabled } = input;
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.releaseStreams === true,
  );
  const query = useFetchQuery({
    queryKey: releaseStreamsQueryKey(serverId, cwd),
    dataShape: "value",
    staleTimeMs: POLL_MS,
    queryFn: async () => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      // The streams live on origin and upstream, not in this checkout's own branch; the daemon
      // fetches at most once a minute however often this asks.
      return client.checkoutStreamsGetGraph(cwd, { fetch: true });
    },
    enabled: supported && enabled && !!client && isConnected && !!cwd,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: false,
  });

  return {
    supported,
    data: query.data ?? null,
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
