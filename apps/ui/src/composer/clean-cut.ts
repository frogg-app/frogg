/**
 * COMPAT(agentCleanCut): added in v1.7.0, remove after 2027-09-27.
 *
 * A clean cut ends the agent's provider conversation and starts a fresh one
 * primed with a cheap summary of it. It can be started from the composer's
 * stale-context notice, the account transfer sheet or the provider switcher,
 * so its in-flight state lives here, keyed by agent, and every entry point
 * shows the same pending and error state.
 */
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";

export interface CleanCutTarget {
  provider?: string;
  providerAccountId?: string | null;
  model?: string | null;
  thinkingOptionId?: string | null;
}

interface CleanCutEntry {
  pending: boolean;
  error: string | null;
}

interface CleanCutStore {
  entries: Record<string, CleanCutEntry>;
  set: (key: string, entry: CleanCutEntry) => void;
}

const IDLE: CleanCutEntry = { pending: false, error: null };

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
  /** Resolves null once the fresh conversation is in place, else the error. */
  run: (target?: CleanCutTarget) => Promise<string | null>;
}

export function useCleanCut(serverId: string, agentId: string | null | undefined): CleanCutControl {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const supported = useHostFeature(serverId, "agentCleanCut");
  const key = entryKey(serverId, agentId ?? "");
  const entry = useCleanCutStore((state) => state.entries[key] ?? IDLE);
  const setEntry = useCleanCutStore((state) => state.set);

  const run = useCallback(
    async (target: CleanCutTarget = {}): Promise<string | null> => {
      if (!client || !agentId) return t("composer.cleanCut.failed");
      if (useCleanCutStore.getState().entries[key]?.pending) return t("composer.cleanCut.pending");
      setEntry(key, { pending: true, error: null });
      try {
        await client.cleanCutAgent(agentId, target);
        setEntry(key, IDLE);
        return null;
      } catch (cause: unknown) {
        const error =
          cause instanceof Error && cause.message ? cause.message : t("composer.cleanCut.failed");
        setEntry(key, { pending: false, error });
        return error;
      }
    },
    [agentId, client, key, setEntry, t],
  );

  return {
    available: supported && client !== null && Boolean(agentId),
    pending: entry.pending,
    error: entry.error,
    run,
  };
}
