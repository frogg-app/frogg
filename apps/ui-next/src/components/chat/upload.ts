// Streams picked files to a host in chunks, with progress and cancel, so a multi-gigabyte zip
// never has to fit in memory.
import { FILE_UPLOAD_MAX_BYTES } from "@frogg/protocol/messages";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { create } from "zustand";

export type UploadedFile = NonNullable<Awaited<ReturnType<DaemonClient["uploadFile"]>>["file"]>;

/** A picked file, before it goes to the daemon. */
export interface Picked {
  name: string;
  mimeType: string;
  size: number;
  /** base64 without a data: prefix; set only for images small enough to send to the model. */
  base64?: string;
  /** Reads bytes [start, end) of the file. */
  read: (start: number, end: number) => Promise<Uint8Array>;
}

/** Images up to this size go to the model inline; larger ones upload as files. */
export const INLINE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const UPLOAD_MAX_BYTES = FILE_UPLOAD_MAX_BYTES;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** The friendly refusal for a file over the limit, or null when it can be sent. */
export function tooLarge(name: string, size: number): string | null {
  if (size <= UPLOAD_MAX_BYTES) return null;
  return `${name} is ${formatBytes(size)}. Files up to ${formatBytes(UPLOAD_MAX_BYTES)} can be sent; split or compress it first.`;
}

export const isCancelled = (e: unknown) => e instanceof Error && e.name === "AbortError";

interface Progress {
  sent: number;
  total: number;
}

/** Live progress of uploads in flight, keyed by the attachment id. */
export const useUploads = create<Record<string, Progress>>(() => ({}));
const controllers = new Map<string, AbortController>();

/** Stops an upload in flight; the host discards the partial file. */
export function cancelUpload(id: string): void {
  controllers.get(id)?.abort();
}

export async function uploadPicked(
  client: DaemonClient,
  p: Picked,
  id: string,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  const refused = tooLarge(p.name, p.size);
  if (refused) throw new Error(refused);
  const abort = new AbortController();
  const stop = () => abort.abort();
  signal?.addEventListener("abort", stop, { once: true });
  controllers.set(id, abort);
  let shown = 0;
  try {
    const res = await client.uploadFileStream({
      fileName: p.name,
      mimeType: p.mimeType || "application/octet-stream",
      size: p.size,
      read: p.read,
      signal: abort.signal,
      onProgress: (sent, total) => {
        // A few hundred store updates over a whole upload, not one per chunk.
        if (sent !== total && sent - shown < total / 200) return;
        shown = sent;
        useUploads.setState({ [id]: { sent, total } });
      },
    });
    if (res.error || !res.file) throw new Error(res.error ?? `Could not upload ${p.name}`);
    return res.file;
  } finally {
    signal?.removeEventListener("abort", stop);
    controllers.delete(id);
    useUploads.setState((st) => {
      const next = { ...st };
      delete next[id];
      return next;
    }, true);
  }
}
