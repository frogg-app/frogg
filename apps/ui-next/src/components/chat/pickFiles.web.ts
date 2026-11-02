import { INLINE_IMAGE_MAX_BYTES, tooLarge, type Picked } from "./upload";

export const canPickFiles = true;

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.addEventListener("error", () => reject(r.error ?? new Error("Could not read file")), {
      once: true,
    });
    r.addEventListener(
      "load",
      () => {
        const url = String(r.result);
        resolve(url.slice(url.indexOf(",") + 1));
      },
      { once: true },
    );
    r.readAsDataURL(file);
  });
}

/**
 * Wraps a browser file. Small images are read up front so they can go to the model; everything
 * else is read a chunk at a time while it uploads, so size is bounded by the host, not memory.
 */
export async function readFile(file: File, inlineImages = true): Promise<Picked> {
  const refused = tooLarge(file.name, file.size);
  if (refused) throw new Error(refused);
  const mimeType = file.type || "application/octet-stream";
  const inline =
    inlineImages && mimeType.startsWith("image/") && file.size <= INLINE_IMAGE_MAX_BYTES;
  return {
    name: file.name,
    mimeType,
    size: file.size,
    ...(inline ? { base64: await readBase64(file) } : {}),
    read: async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
  };
}

/** Opens the browser file chooser and wraps the picks. */
export function pickFiles(opts: { images?: boolean } = {}): Promise<Picked[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    if (opts.images) input.accept = "image/*";
    input.addEventListener("cancel", () => resolve([]), { once: true });
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        void Promise.all(files.map((f) => readFile(f))).then(resolve, reject);
      },
      { once: true },
    );
    input.click();
  });
}
