// What rode along with a message this device sent, keyed by the message id the daemon echoes back
// as the user message's `clientMessageId`. The daemon's timeline keeps only a message's text, so
// without this a sent screenshot or file would vanish from the conversation once sent.
//
// Images keep their picture for as long as the app runs; across a reload only the names survive
// (pictures would overrun web storage), and the bubble shows them as chips.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import type { Attachment } from "./actions";

export interface SentAttachment {
  /** The attachment's id when it was picked: unique within its message. */
  id: string;
  kind: "image" | "file";
  name: string;
  /** data: URI, images only, while the app that sent it runs. */
  uri?: string;
}

const KEY = "ui-next.sent-attachments";
/** Messages remembered across reloads; older ones drop off first. */
const KEEP = 200;

export const useSentAttachments = create<Record<string, SentAttachment[]>>(() => ({}));

let seq = 0;
/** A message id unique enough to key a send (the daemon only needs it to be unique per agent). */
export function newMessageId(): string {
  seq += 1;
  return `m-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** What a sent message's bubble shows for its attachments (fork contexts are not shown). */
export function describe(attachments: readonly Attachment[]): SentAttachment[] {
  return attachments.flatMap<SentAttachment>((a) => {
    if (a.kind === "image")
      return [
        { id: a.id, kind: "image", name: a.name, uri: `data:${a.mimeType};base64,${a.data}` },
      ];
    if (a.kind === "file") return [{ id: a.id, kind: "file", name: a.name }];
    return [];
  });
}

export function rememberSent(messageId: string, attachments: readonly Attachment[]): void {
  const list = describe(attachments);
  if (!list.length) return;
  useSentAttachments.setState({ [messageId]: list });
  persist();
}

function persist(): void {
  const all = Object.entries(useSentAttachments.getState()).slice(-KEEP);
  const slim = Object.fromEntries(
    all.map(([id, list]) => [id, list.map(({ id: key, kind, name }) => ({ id: key, kind, name }))]),
  );
  void AsyncStorage.setItem(KEY, JSON.stringify(slim)).catch(() => undefined);
}

void AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (!raw) return raw;
    const saved = JSON.parse(raw) as Record<string, SentAttachment[]>;
    // Anything sent since start-up (with its pictures) wins over the saved names.
    useSentAttachments.setState((cur) => ({ ...saved, ...cur }), true);
    return raw;
  })
  .catch(() => undefined);
