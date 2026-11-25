// A picture on the device clipboard, read as a picked file. Native only: on web and desktop a
// paste into the composer carries the picture itself (see `pasteImages.web.ts`).
import { Buffer } from "buffer";
import { pastedName } from "./pasteRules";
import { INLINE_IMAGE_MAX_BYTES, tooLarge, type Picked } from "./upload";

export interface ClipboardImageReader {
  hasImageAsync: () => Promise<boolean>;
  getImageAsync: (options: { format: "png" }) => Promise<{ data: string } | null>;
}

/** A `data:` URL as a picked file; null when it is not a base64 image. */
export function pickedFromDataUrl(dataUrl: string, name?: string): Picked | null {
  const m = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  const [, mimeType, base64] = m;
  const bytes = Buffer.from(base64, "base64");
  const fileName = name ?? pastedName(mimeType);
  const refused = tooLarge(fileName, bytes.length);
  if (refused) throw new Error(refused);
  return {
    name: fileName,
    mimeType,
    size: bytes.length,
    ...(bytes.length <= INLINE_IMAGE_MAX_BYTES ? { base64 } : {}),
    read: async (start, end) => new Uint8Array(bytes.subarray(start, end)),
  };
}

/** The clipboard's picture as a picked file, or null when it holds none. */
export async function readClipboardPicture(clip: ClipboardImageReader): Promise<Picked | null> {
  if (!(await clip.hasImageAsync())) return null;
  const image = await clip.getImageAsync({ format: "png" });
  return image ? pickedFromDataUrl(image.data) : null;
}
