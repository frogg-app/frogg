import type { Picked } from "./upload";

// Web and desktop paste pictures straight into the composer (Ctrl+V), so the + menu skips the
// clipboard there: reading it from script would raise a browser permission prompt.
export const canPastePicture = false;

export function clipboardHasPicture(): Promise<boolean> {
  return Promise.resolve(false);
}

export function pasteClipboardPicture(): Promise<Picked | null> {
  return Promise.resolve(null);
}
