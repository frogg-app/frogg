// Whether a paste that carries pictures should attach them or paste its text. Copying from a
// document (Word, Docs, a web page selection) puts the text plus a rendered picture of it on the
// clipboard, and the user wants the text. Copying a picture or a file puts the picture with, at
// most, a name or an address as text, and the user wants the picture.

export interface PastedFile {
  name: string;
  type: string;
}

const IMAGE_NAME = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|tiff?|avif)$/i;
const ADDRESS = /^(https?:|data:|file:)\S*$/i;

/** The browser's stand-in name for a picture with no file behind it (`image.png`). */
export function isUnnamed(name: string): boolean {
  return !name || /^image\.\w+$/i.test(name);
}

/** A file name or path ending in a picture extension; an address inside it means it is prose. */
function isFileName(line: string): boolean {
  return line.length <= 255 && IMAGE_NAME.test(line) && !line.includes("://");
}

/**
 * True when the text beside a pasted picture is only its name or address. A file manager puts
 * the file's name (spaces and all) or path as text, one per line when several are copied.
 */
function incidental(text: string): boolean {
  const lines = text
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.every((l) => ADDRESS.test(l) || isFileName(l));
}

/** The pictures to attach from a paste, or none to let the text paste as usual. */
export function picturesToAttach<F extends PastedFile>(files: readonly F[], text: string): F[] {
  const pictures = files.filter((f) => f.type.startsWith("image/"));
  if (!pictures.length) return [];
  // A named file was copied as a file (a screenshot from the desktop, a file manager copy).
  const named = pictures.some((f) => !isUnnamed(f.name));
  return named || incidental(text) ? pictures : [];
}

let pasted = 0;

/** A name for a picture pasted without one: `Pasted image 3.png`. */
export function pastedName(mimeType: string): string {
  pasted += 1;
  const ext = mimeType.split("/")[1]?.split("+")[0] || "png";
  return `Pasted image ${pasted}.${ext === "jpeg" ? "jpg" : ext}`;
}
