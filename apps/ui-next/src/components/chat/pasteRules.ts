// Whether a paste that carries pictures should attach them or paste its text. Copying from a
// document (Word, Docs, a web page selection) puts the text plus a rendered picture of it on the
// clipboard, and the user wants the text. Copying a picture or a file puts the picture with, at
// most, a name or an address as text, and the user wants the picture.

export interface PastedFile {
  name: string;
  type: string;
}

/** True when the text beside a pasted picture is only its name or address. */
function incidental(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/\s/.test(t)) return false;
  return /^(https?:|data:|file:)/i.test(t) || /\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(t);
}

/** The pictures to attach from a paste, or none to let the text paste as usual. */
export function picturesToAttach<F extends PastedFile>(files: readonly F[], text: string): F[] {
  const pictures = files.filter((f) => f.type.startsWith("image/"));
  if (!pictures.length) return [];
  // A named file was copied as a file (a screenshot from the desktop, a file manager copy).
  const named = pictures.some((f) => f.name && !/^image\.\w+$/i.test(f.name));
  return named || incidental(text) ? pictures : [];
}
