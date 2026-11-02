import { useEffect, type RefObject } from "react";
import type { TextInput } from "react-native";
import { toastError } from "../toast/store";
import { prepareAttachment, type Attachment } from "./actions";
import { picturesToAttach } from "./pasteRules";
import { readFile } from "./pickFiles.web";

let pasted = 0;

/** Images pasted into the composer become attachments, the same as picking them with +. */
export function usePasteImages(
  input: RefObject<TextInput | null>,
  onAdd: (a: Attachment[]) => void,
  enabled: boolean,
): void {
  useEffect(() => {
    // On web the TextInput ref is the textarea itself.
    const el = input.current as unknown as HTMLElement | null;
    if (!enabled || !el?.addEventListener) return;
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      // Some browsers expose a pasted picture only as an item, not in `files`.
      const files = Array.from(data?.files ?? []);
      if (!files.length)
        for (const item of Array.from(data?.items ?? [])) {
          const f = item.kind === "file" ? item.getAsFile() : null;
          if (f) files.push(f);
        }
      const images = picturesToAttach(files, data?.getData("text/plain") ?? "");
      if (!images.length) return;
      e.preventDefault();
      const named = images.map((f) => {
        if (f.name && f.name !== "image.png") return f;
        pasted += 1;
        const ext = f.type.split("/")[1] ?? "png";
        return new File([f], `Pasted image ${pasted}.${ext}`, { type: f.type });
      });
      Promise.all(named.map(readFile))
        .then((picked) => Promise.all(picked.map(prepareAttachment)))
        .then(onAdd, (err: unknown) => toastError("Could not attach the pasted image", err));
    };
    el.addEventListener("paste", onPaste);
    return () => el.removeEventListener("paste", onPaste);
  }, [input, onAdd, enabled]);
}
