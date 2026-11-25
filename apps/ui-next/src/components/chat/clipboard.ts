import * as Clipboard from "expo-clipboard";
import { readClipboardPicture } from "./clipboardImage";
import type { Picked } from "./upload";

/** The + menu offers "Paste image" when the clipboard holds one. */
export const canPastePicture = true;

/** Whether the clipboard holds a picture (reads only its description, not the picture). */
export function clipboardHasPicture(): Promise<boolean> {
  return Clipboard.hasImageAsync().catch(() => false);
}

export function pasteClipboardPicture(): Promise<Picked | null> {
  return readClipboardPicture(Clipboard);
}
