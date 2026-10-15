import { createEntry, type Entry, fetchDownload } from "../../daemon/files";
import { fmtBytes } from "../settings/pages/kit";
import { dismissToast, toast } from "../toast/store";
import type { PromptSpec } from "./Prompt";
import { saveFile } from "./saveFile";

export function newEntrySpec(
  parent: string,
  kind: "file" | "directory",
  openFile: (p: string) => void,
): PromptSpec {
  return {
    eyebrow: parent === "." ? "Files" : `Files · ${parent}`,
    title: kind === "file" ? "New file" : "New folder",
    placeholder: kind === "file" ? "name.ts" : "folder",
    action: "Create",
    run: async (name) => {
      const err = await createEntry(parent, name, kind);
      if (!err && kind === "file") openFile(parent === "." ? name : `${parent}/${name}`);
      return err;
    },
  };
}

/** Downloads a file, or a folder as a zip, to this device, reporting progress in toasts. */
export async function downloadEntry(path: string, kind: Entry["kind"]): Promise<void> {
  const name = path.split("/").pop() || path;
  const pending =
    kind === "directory"
      ? toast({ kind: "info", title: `Zipping ${name}…`, detail: "Large folders take a moment" })
      : null;
  try {
    const file = await fetchDownload(path, kind);
    if (pending) dismissToast(pending);
    if (!(await saveFile(file.name, file.bytes, file.mime))) return;
    const parts = [fmtBytes(file.bytes.length)];
    if (file.fileCount !== undefined) parts.unshift(`${file.fileCount} files`);
    if (file.skipped?.length) parts.push(`left out ${skippedSummary(file.skipped)}`);
    toast({ title: `Downloaded ${file.name}`, detail: parts.join(" · ") });
  } catch (e) {
    if (pending) dismissToast(pending);
    toast({
      kind: "error",
      title: `Couldn't download ${name}`,
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

const skippedSummary = (paths: string[]) =>
  paths.length <= 2 ? paths.join(", ") : `${paths.slice(0, 2).join(", ")} +${paths.length - 2}`;
