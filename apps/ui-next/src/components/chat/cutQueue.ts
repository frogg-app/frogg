// A message held back while a clean cut (or another conversation-rewriting operation) runs, and
// sent once it finishes. One per session: sending again while one waits replaces it with the
// two joined, so nothing typed is lost. A failed operation keeps the message for the user to send
// or drop; it is never sent on top of a conversation the operation left half-way.
import { create } from "zustand";
import type { Attachment } from "./actions";

export interface Queued {
  text: string;
  attachments: Attachment[];
  /** `failed`: the operation it waited on failed, so it was not sent. */
  state: "waiting" | "failed";
}

export const useCutQueue = create<Record<string, Queued | undefined>>(() => ({}));

type Sender = (agentId: string, text: string, attachments: Attachment[]) => Promise<void>;

let sender: Sender | null = null;

/** Wires the real send (Chat registers sendWithAttachments; tests pass a fake). */
export function setQueueSender(fn: Sender | null): void {
  sender = fn;
}

/** Holds a message until the session's running operation finishes. */
export function queueMessage(agentId: string, text: string, attachments: Attachment[]): void {
  useCutQueue.setState((st) => {
    const cur = st[agentId];
    const joined = cur?.text && text ? `${cur.text}\n\n${text}` : cur?.text || text;
    return {
      [agentId]: {
        text: joined,
        attachments: [...(cur?.attachments ?? []), ...attachments],
        state: "waiting",
      },
    };
  });
}

export function dropQueued(agentId: string): void {
  useCutQueue.setState({ [agentId]: undefined });
}

/** Sends the held message now (the user's "Send now" after a failed operation). */
export async function sendQueued(agentId: string): Promise<void> {
  const q = useCutQueue.getState()[agentId];
  if (!q || !sender) return;
  useCutQueue.setState({ [agentId]: undefined });
  try {
    await sender(agentId, q.text, q.attachments);
  } catch (e) {
    useCutQueue.setState({ [agentId]: { ...q, state: "failed" } });
    throw e;
  }
}

/** Called when the session's operation finishes: send what waited, or keep it after a failure. */
export async function settleQueue(agentId: string, ok: boolean): Promise<void> {
  const q = useCutQueue.getState()[agentId];
  if (!q || q.state !== "waiting") return;
  if (!ok) {
    useCutQueue.setState({ [agentId]: { ...q, state: "failed" } });
    return;
  }
  await sendQueued(agentId);
}
