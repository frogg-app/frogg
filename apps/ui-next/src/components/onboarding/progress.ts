import { useMemo } from "react";
import { useConfig } from "../../daemon/config";
import { useDaemon } from "../../daemon/store";
import { doneSet, type Live, type StepId } from "./model";
import { useOnboarding } from "./store";

export function useLive(): Live {
  const online = useDaemon((st) => st.conn === "online");
  const hasSession = useDaemon((st) => Object.keys(st.sessions).length > 0);
  const providerReady = useConfig(
    (st) => st.providers?.entries.some((e) => e.status === "ready" && e.enabled !== false) ?? false,
  );
  return useMemo(
    () => ({ online, providerReady, hasSession }),
    [online, providerReady, hasSession],
  );
}

export function useDone(): Set<StepId> {
  const seen = useOnboarding((st) => st.seen);
  const live = useLive();
  return useMemo(() => doneSet(seen, live), [seen, live]);
}
