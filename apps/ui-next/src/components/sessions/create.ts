// New-session helpers that work against any connected host, not just the active one.
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { isCancelled, uploadPicked, type Picked, type UploadedFile } from "../chat/upload";

export type HostProviders = Awaited<ReturnType<DaemonClient["getProvidersSnapshot"]>>;

/** A picked file waiting for the session to be created. */
export interface Draft extends Picked {
  id: string;
}

let seq = 0;
export const toDraft = (p: Picked): Draft => {
  seq += 1;
  return { ...p, id: `d${seq}` };
};

/** Small images go to the model inline; everything else is uploaded as a file. */
export const isImage = (d: Draft) => d.base64 !== undefined;

/** Images ride inline; other files stream to the chosen host first. */
export async function prepareDrafts(
  client: DaemonClient,
  drafts: Draft[],
): Promise<{ images: Array<{ data: string; mimeType: string }>; attachments: UploadedFile[] }> {
  const images = drafts.flatMap((d) =>
    d.base64 !== undefined ? [{ data: d.base64, mimeType: d.mimeType }] : [],
  );
  const attachments: UploadedFile[] = [];
  for (const d of drafts.filter((x) => !isImage(x))) {
    try {
      attachments.push(await uploadPicked(client, d, d.id));
    } catch (e) {
      throw isCancelled(e) ? new Error(`Upload of ${d.name} cancelled`) : e;
    }
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
