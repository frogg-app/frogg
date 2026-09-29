/**
 * COMPAT(agentCleanCut): added in v1.6.2, remove after 2027-09-27.
 *
 * A clean cut ends the agent's provider conversation and starts a fresh one
 * primed with a cheap summary of it. It can be started from the composer's
 * stale-context notice, the account transfer sheet or the provider switcher,
 * so its in-flight state lives here, keyed by agent, and every entry point
 * shows the same pending and error state.
 *
 * Nothing is sent for the user while the summariser runs. A message sent
 * meanwhile waits in the agent's queue and is drained into the fresh
 * conversation once it is in place; `ready` then tells the composer that the
 * next send goes straight into it.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { summarizeCleanCutSubagents } from "@/composer/clean-cut-summary";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { useHostFeature } from "@/runtime/host-features";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";

export interface CleanCutTarget {
  provider?: string;
  providerAccountId?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
}

interface CleanCutEntry {
  pending: boolean;
  error: string | null;
  /** When the running cut started, for the composer's elapsed time. */
  startedAt: number | null;
  /** A cut finished and nothing has been sent into the fresh conversation yet. */
  ready: boolean;
}

interface CleanCutStore {
  entries: Record<string, CleanCutEntry>;
  set: (key: string, entry: CleanCutEntry) => void;
}

const IDLE: CleanCutEntry = { pending: false, error: null, startedAt: null, ready: false };

const useCleanCutStore = create<CleanCutStore>((set) => ({
  entries: {},
  set: (key, entry) => set((state) => ({ entries: { ...state.entries, [key]: entry } })),
}));

function entryKey(serverId: string, agentId: string): string {
  return `${serverId}\0${agentId}`;
}

export interface CleanCutControl {
  /** The daemon can make a clean cut and there is a connection to ask it on. */
  available: boolean;
  pending: boolean;
  error: string | null;
  startedAt: number | null;
  ready: boolean;
  /** Clears `ready`, once something has been sent into the fresh conversation. */
  acknowledge: () => void;
  /** Resolves null once the fresh conversation is in place, else the error. */
  run: (target?: CleanCutTarget) => Promise<string | null>;
}

export function useCleanCut(serverId: string, agentId: string | null | undefined): CleanCutControl {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const supported = useHostFeature(serverId, "agentCleanCut");
  const key = entryKey(serverId, agentId ?? "");
  const entry = useCleanCutStore((state) => state.entries[key] ?? IDLE);
  const setEntry = useCleanCutStore((state) => state.set);

  const run = useCallback(
    async (target: CleanCutTarget = {}): Promise<string | null> => {
      if (!client || !agentId) return t("composer.cleanCut.failed");
      if (useCleanCutStore.getState().entries[key]?.pending) return t("composer.cleanCut.pending");
      setEntry(key, { ...IDLE, pending: true, startedAt: Date.now() });
      try {
        const result = await client.cleanCutAgent(agentId, target);
        const runtime = getHostRuntimeStore();
        const queued =
          (useSessionStore.getState().sessions[serverId]?.queuedMessages.get(agentId)?.length ??
            0) > 0;
        setEntry(key, { ...IDLE, ready: !queued });
        // What was sent while the summariser ran goes into the fresh conversation.
        if (queued) runtime.drainQueuedAgentMessage(serverId, agentId);
        // Every entry point closes or moves on after a cut, so the subagent
        // outcome is reported here, once, in a toast that outlives it.
        const summary = summarizeCleanCutSubagents(t, result?.subagents ?? []);
        if (summary) {
          toast.show(summary.text, {
            variant: summary.hasFailures ? "warning" : "success",
            durationMs: summary.hasFailures ? 8000 : 4000,
            testID: "clean-cut-subagents-toast",
          });
        }
        return null;
      } catch (cause: unknown) {
        const error =
          cause instanceof Error && cause.message ? cause.message : t("composer.cleanCut.failed");
        setEntry(key, { ...IDLE, error });
        return error;
      }
    },
    [agentId, client, key, serverId, setEntry, t, toast],
  );

  const acknowledge = useCallback(() => {
    if (useCleanCutStore.getState().entries[key]?.ready) setEntry(key, IDLE);
  }, [key, setEntry]);

  return {
    available: supported && client !== null && Boolean(agentId),
    pending: entry.pending,
    error: entry.error,
    startedAt: entry.startedAt,
    ready: entry.ready,
    acknowledge,
    run,
  };
}
