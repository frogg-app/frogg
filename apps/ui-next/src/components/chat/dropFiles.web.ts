import { useEffect, useRef, useState, type RefObject } from "react";
import type { View } from "react-native";
import { toastError } from "../toast/store";
import { readFile } from "./pickFiles.web";
import type { Picked } from "./upload";

const carriesFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");

/**
 * Files dragged from the OS onto `target` are read like picked ones and handed to `onDrop`.
 * Returns whether a file drag is over the target, for a drop highlight.
 */
export function useDropFiles(
  target: RefObject<View | null>,
  onDrop: (picked: Picked[]) => void,
  opts: { enabled: boolean; inlineImages?: boolean },
): boolean {
  const [over, setOver] = useState(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  const { enabled, inlineImages = true } = opts;
  useEffect(() => {
    // On web a View ref is its div.
    const el = target.current as unknown as HTMLElement | null;
    if (!enabled || !el?.addEventListener) return;
    // enter/leave fire for every child crossed; count them so the highlight doesn't flicker.
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setOver(true);
    };
    const move = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      // Without this the browser opens the file instead of dropping it here.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      Promise.all(files.map((f) => readFile(f, inlineImages))).then(
        (picked) => latest.current(picked),
        (err: unknown) => toastError("Could not attach the dropped file", err),
      );
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragover", move);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragover", move);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
      setOver(false);
    };
  }, [target, enabled, inlineImages]);
  return over;
}
