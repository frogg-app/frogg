// Android's picker can hand back a photo as `image:1000014295` with no MIME type. Without one it
// uploads as an opaque file instead of going to the model as an image, so read the magic bytes.

const SIGNATURES: { mime: string; ext: string; test: (b: Uint8Array) => boolean }[] = [
  { mime: "image/png", ext: "png", test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47]) },
  { mime: "image/jpeg", ext: "jpg", test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { mime: "image/gif", ext: "gif", test: (b) => starts(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    mime: "image/webp",
    ext: "webp",
    test: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && ascii(b, 8, "WEBP"),
  },
  {
    mime: "image/heic",
    ext: "heic",
    test: (b) => ascii(b, 4, "ftyp") && ["heic", "heix", "mif1"].some((t) => ascii(b, 8, t)),
  },
];

/** Bytes needed to recognise every signature above. */
export const SNIFF_BYTES = 12;

function starts(b: Uint8Array, sig: number[]): boolean {
  return sig.every((x, i) => b[i] === x);
}

function ascii(b: Uint8Array, at: number, s: string): boolean {
  return [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
}

/** True when the picker gave no usable type, so the bytes should decide. */
export const untyped = (mime: string | null | undefined): boolean =>
  !mime || mime === "application/octet-stream";

/** The image type the leading bytes declare, or null. */
export function sniffImage(head: Uint8Array): { mime: string; ext: string } | null {
  return SIGNATURES.find((x) => x.test(head)) ?? null;
}

/** A display name for a sniffed image: `image:123` becomes `image-123.png`. */
export function imageName(name: string, ext: string): string {
  const clean = name.replace(/[:/\\]/g, "-");
  return /\.[a-z0-9]{2,5}$/i.test(clean) ? clean : `${clean}.${ext}`;
}
