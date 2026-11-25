import { useEffect, useRef, type RefObject } from "react";
import type { TextInput } from "react-native";
import { toastError } from "../toast/store";
import { isUnnamed, pastedName, picturesToAttach } from "./pasteRules";
import { readFile } from "./pickFiles.web";
import type { Picked } from "./upload";

/** The files on a paste: some browsers expose a pasted picture only as an item, not in `files`. */
function pastedFiles(data: DataTransfer | null): File[] {
  const files = Array.from(data?.files ?? []);
  if (files.length) return files;
  for (const item of Array.from(data?.items ?? [])) {
    const f = item.kind === "file" ? item.getAsFile() : null;
    if (f) files.push(f);
  }
  return files;
}

/**
 * Pictures pasted into `input` are read like picked files and handed to `onPicked`, the same as
 * picking them with +. A paste that is really text (a document copy) pastes as text.
 */
export function usePastePictures(
  input: RefObject<TextInput | null>,
  onPicked: (picked: Picked[]) => void,
  enabled: boolean,
): void {
  const latest = useRef(onPicked);
  latest.current = onPicked;
  useEffect(() => {
    // On web the TextInput ref is the textarea itself.
    const el = input.current as unknown as HTMLElement | null;
    if (!enabled || !el?.addEventListener) return;
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      const images = picturesToAttach(pastedFiles(data), data?.getData("text/plain") ?? "");
      if (!images.length) return;
      e.preventDefault();
      const named = images.map((f) =>
        isUnnamed(f.name) ? new File([f], pastedName(f.type), { type: f.type }) : f,
      );
      Promise.all(named.map((f) => readFile(f))).then(
        (picked) => latest.current(picked),
        (err: unknown) => toastError("Could not attach the pasted image", err),
      );
    };
    el.addEventListener("paste", onPaste);
    return () => el.removeEventListener("paste", onPaste);
  }, [input, enabled]);
}
