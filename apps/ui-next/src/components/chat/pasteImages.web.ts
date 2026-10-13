import { useEffect, type RefObject } from "react";
import type { TextInput } from "react-native";
import { toastError } from "../toast/store";
import { prepareAttachment, type Attachment } from "./actions";
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
      const images = Array.from(data?.files ?? []).filter((f) => f.type.startsWith("image/"));
      // Copying from a document puts its text plus a rendered picture of it: paste the text.
      if (!images.length || data?.getData("text/plain")) return;
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
