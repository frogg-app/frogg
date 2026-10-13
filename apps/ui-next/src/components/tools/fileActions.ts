import { createEntry } from "../../daemon/files";
import type { PromptSpec } from "./Prompt";

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
