import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { imageName, SNIFF_BYTES, sniffImage, untyped } from "./sniff";
import { INLINE_IMAGE_MAX_BYTES, tooLarge, type Picked } from "./upload";

export const canPickFiles = true;

/**
 * Wraps a picked document. Small images are read up front so they can go to the model; everything
 * else is read a chunk at a time while it uploads, so size is bounded by the host, not memory.
 */
async function wrap(asset: DocumentPicker.DocumentPickerAsset): Promise<Picked> {
  const file = new File(asset.uri);
  const size = asset.size ?? file.size;
  const refused = tooLarge(asset.name, size);
  if (refused) throw new Error(refused);
  let name = asset.name;
  let mimeType = asset.mimeType || file.type || "application/octet-stream";
  if (untyped(mimeType)) {
    const sniffed = sniffImage(readHead(file, Math.min(size, SNIFF_BYTES)));
    if (sniffed) {
      mimeType = sniffed.mime;
      name = imageName(name, sniffed.ext);
    }
  }
  const inline = mimeType.startsWith("image/") && size <= INLINE_IMAGE_MAX_BYTES;
  return {
    name,
    mimeType,
    size,
    ...(inline ? { base64: await file.base64() } : {}),
    read: async (start, end) => {
      const handle = file.open();
      try {
        handle.offset = start;
        return handle.readBytes(end - start);
      } finally {
        handle.close();
      }
    },
  };
}

function readHead(file: File, n: number): Uint8Array {
  if (n <= 0) return new Uint8Array();
  const handle = file.open();
  try {
    return handle.readBytes(n);
  } finally {
    handle.close();
  }
}

/** Opens the system document picker; files are copied to the app cache so they stay readable. */
export async function pickFiles(opts: { images?: boolean } = {}): Promise<Picked[]> {
  const res = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
    type: opts.images ? "image/*" : "*/*",
  });
  if (res.canceled) return [];
  return Promise.all(res.assets.map(wrap));
}
