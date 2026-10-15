/**
 * Hands bytes to the browser as a download. In the desktop shell Electron shows its save dialog
 * for it; in a browser it lands wherever the browser saves downloads.
 */
export async function saveFile(name: string, bytes: Uint8Array, mime: string): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // The click starts the download synchronously; give the browser a beat before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return true;
}
