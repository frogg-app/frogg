import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
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
  const mimeType = asset.mimeType || file.type || "application/octet-stream";
  const inline = mimeType.startsWith("image/") && size <= INLINE_IMAGE_MAX_BYTES;
  return {
    name: asset.name,
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
