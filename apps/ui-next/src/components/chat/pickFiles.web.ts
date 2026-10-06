import type { Picked } from "./actions";

export const canPickFiles = true;

function read(file: File): Promise<Picked> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.addEventListener("error", () => reject(r.error ?? new Error("Could not read file")), {
      once: true,
    });
    r.addEventListener(
      "load",
      () => {
        const url = String(r.result);
        resolve({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          base64: url.slice(url.indexOf(",") + 1),
          size: file.size,
        });
      },
      { once: true },
    );
    r.readAsDataURL(file);
  });
}

/** Opens the browser file chooser and reads the picks as base64. */
export function pickFiles(opts: { images?: boolean }): Promise<Picked[]> {
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
        void Promise.all(files.map(read)).then(resolve, reject);
      },
      { once: true },
    );
    input.click();
  });
}
