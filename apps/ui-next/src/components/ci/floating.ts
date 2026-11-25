// Floating CI job cards: the daemon watches the checkout's own GitHub Actions runs and pushes
// `checkout.ci.watched_runs.update`; this module holds that set per cwd, which cards the user
// dismissed and where they dragged them.
import { useEffect } from "react";
import { create } from "zustand";
import { hasFeature } from "../chat/actions";
import { getClient, useDaemon } from "../../daemon/store";
import { hasHiddenActive } from "./face";
import type { CiRun } from "./model";

export * from "./face";

interface FloatingCiStore {
  /** Watched runs per cwd: active ones plus ones that finished in the last few minutes. */
  runs: Record<string, CiRun[]>;
  /** Run ids whose card the user closed. A rerun keeps its id, so it stays closed too. */
  dismissed: Record<string, true>;
  /** Drag offset per run id, from the card's resting slot. */
  offset: Record<string, { x: number; y: number }>;
}

export const useFloatingCi = create<FloatingCiStore>(() => ({
  runs: {},
  dismissed: {},
  offset: {},
}));

const EMPTY: CiRun[] = [];

export const setWatchedRuns = (cwd: string, runs: CiRun[]) =>
  useFloatingCi.setState((st) => ({ runs: { ...st.runs, [cwd]: runs } }));

export const dismissCiCard = (id: string) =>
  useFloatingCi.setState((st) => ({ dismissed: { ...st.dismissed, [id]: true } }));

export const moveCiCard = (id: string, x: number, y: number) =>
  useFloatingCi.setState((st) => ({ offset: { ...st.offset, [id]: { x, y } } }));

/** Brings back every dismissed card for `cwd` that is still running, at its resting slot. */
export function showFloatingCi(cwd: string) {
  useFloatingCi.setState((st) => {
    const dismissed = { ...st.dismissed };
    const offset = { ...st.offset };
    for (const run of st.runs[cwd] ?? EMPTY) {
      delete dismissed[run.id];
      delete offset[run.id];
    }
    return { dismissed, offset };
  });
}

export const useWatchedRuns = (cwd: string) => useFloatingCi((st) => st.runs[cwd] ?? EMPTY);

export function useHasHiddenActive(cwd: string): boolean {
  return useFloatingCi((st) => hasHiddenActive(st.runs[cwd] ?? EMPTY, st.dismissed));
}

/**
 * Watches `cwd`'s CI runs for as long as the caller is mounted and the host is online. Hosts
 * without `ciRunWatch` get no cards; nothing falls back to polling.
 */
export function useCiRunWatch(cwd: string | null) {
  const conn = useDaemon((st) => st.conn);
  useEffect(() => {
    const client = getClient();
    if (!cwd || conn !== "online" || !client || !hasFeature("ciRunWatch")) return undefined;
    let live = true;
    const off = client.subscribeRawMessages((msg) => {
      if (msg.type === "checkout.ci.watched_runs.update" && msg.payload.cwd === cwd)
        setWatchedRuns(cwd, msg.payload.runs as CiRun[]);
    });
    client.checkoutCiWatchRuns(cwd).then(
      (res) => {
        // An update can beat the response; only seed from it when it carries something.
        if (live && !res.error && res.runs.length) setWatchedRuns(cwd, res.runs as CiRun[]);
        return undefined;
      },
      () => {},
    );
    return () => {
      live = false;
      off();
      client.checkoutCiUnwatchRuns(cwd).catch(() => {});
    };
  }, [cwd, conn]);
}
