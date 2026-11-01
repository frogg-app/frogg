// One conversation-rewriting operation (move to another account, clean cut) per session at a
// time. Every entry point goes through runSessionOp, so a second click while one is in flight
// is refused instead of running both, and the composer shows the running one.
import { create } from "zustand";
import { dismissToast, toast, toastError } from "../toast/store";
import { settleQueue } from "./cutQueue";

export interface SessionOp {
  /** Present-tense progress line, e.g. "Moving the conversation to work". */
  label: string;
  /** When it started (ms), for the elapsed time on the progress strip. */
  startedAt: number;
}

export const useSessionOps = create<Record<string, SessionOp | undefined>>(() => ({}));

export function useSessionOp(agentId: string): SessionOp | null {
  return useSessionOps((st) => st[agentId] ?? null);
}

/**
 * Runs `fn` as the session's only operation: a sticky progress toast while it runs, then a
 * success or failure toast. Returns false without running when another one is in flight.
 */
export function runSessionOp(
  agentId: string,
  op: { label: string; done: string; doneDetail?: string; failed: string },
  fn: () => Promise<void>,
): boolean {
  if (useSessionOps.getState()[agentId]) {
    toast({
      title: "Another operation is still running",
      detail: useSessionOps.getState()[agentId]?.label,
      kind: "needs",
    });
    return false;
  }
  useSessionOps.setState({ [agentId]: { label: op.label, startedAt: Date.now() } });
  const progress = toast({ title: `${op.label}…`, kind: "info", sticky: true, source: agentId });
  const finish = () => {
    dismissToast(progress);
    useSessionOps.setState({ [agentId]: undefined });
  };
  fn().then(
    () => {
      finish();
      // A message typed while it ran goes out now, onto the new conversation.
      settleQueue(agentId, true).catch((e: unknown) => toastError("Message not sent", e));
      return toast({ title: op.done, detail: op.doneDetail, source: agentId });
    },
    (e: unknown) => {
      finish();
      void settleQueue(agentId, false);
      toastError(op.failed, e);
    },
  );
  return true;
}

/** The plain clean cut (same account), from the session menu or the cold-cache notice. */
export const CUT = {
  label: "Clean cut: summarising the conversation",
  done: "Clean cut done",
  doneDetail: "The next message starts from the summary",
  failed: "Clean cut failed",
};
