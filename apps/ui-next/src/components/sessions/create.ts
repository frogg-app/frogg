// New-session helpers that work against any connected host, not just the active one.
import { Buffer } from "buffer";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { Picked } from "../chat/actions";

export type HostProviders = Awaited<ReturnType<DaemonClient["getProvidersSnapshot"]>>;
type Uploaded = NonNullable<Awaited<ReturnType<DaemonClient["uploadFile"]>>["file"]>;

/** A picked file waiting for the session to be created. */
export interface Draft extends Picked {
  id: string;
}

let seq = 0;
export const toDraft = (p: Picked): Draft => {
  seq += 1;
  return { ...p, id: `d${seq}` };
};

export const isImage = (d: Draft) => d.mimeType.startsWith("image/");

/** Images ride inline; other files are uploaded to the chosen host first. */
export async function prepareDrafts(
  client: DaemonClient,
  drafts: Draft[],
): Promise<{ images: Array<{ data: string; mimeType: string }>; attachments: Uploaded[] }> {
  const images = drafts.filter(isImage).map((d) => ({ data: d.base64, mimeType: d.mimeType }));
  const attachments: Uploaded[] = [];
  for (const d of drafts.filter((x) => !isImage(x))) {
    const res = await client.uploadFile({
      fileName: d.name,
      mimeType: d.mimeType || "application/octet-stream",
      bytes: new Uint8Array(Buffer.from(d.base64, "base64")),
    });
    if (res.error || !res.file) throw new Error(res.error ?? `Could not upload ${d.name}`);
    attachments.push(res.file);
  }
  return { images, attachments };
}

export interface BranchOption {
  value: string;
  label: string;
  hint?: string;
}

/** Every local and published branch of a checkout, newest first, local and remote marked. */
export async function loadBranches(client: DaemonClient, cwd: string): Promise<BranchOption[]> {
  const res = await client.getBranchSuggestions({ cwd, limit: 200 });
  if (res.error) throw new Error(res.error);
  const details = res.branchDetails ?? [];
  if (!details.length) return res.branches.map((b) => ({ value: b, label: b }));
  return details.map((b) => {
    const parts = [
      b.hasLocal ? "local" : null,
      b.hasRemote ? "published" : null,
      b.localAhead || b.localBehind ? `↑${b.localAhead ?? 0} ↓${b.localBehind ?? 0}` : null,
    ].filter(Boolean);
    return { value: b.name, label: b.name, hint: parts.join(" · ") || undefined };
  });
}
