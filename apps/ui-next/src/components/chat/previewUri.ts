import type { Attachment } from "./actions";

/** A data: URI for an attachment whose picture is already on this device, else null. */
export function previewUri(a: Attachment): string | null {
  if (a.kind === "image") return `data:${a.mimeType};base64,${a.data}`;
  if (a.kind === "local" && a.picked.base64 && a.picked.mimeType.startsWith("image/")) {
    return `data:${a.picked.mimeType};base64,${a.picked.base64}`;
  }
  return null;
}
