import { StorageAccessFramework } from "expo-file-system/legacy";

/**
 * Android: the system folder picker (Storage Access Framework) chooses where the file goes,
 * then it is written there. Resolves false when the picker is dismissed.
 */
export async function saveFile(name: string, bytes: Uint8Array, mime: string): Promise<boolean> {
  const access = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!access.granted) return false;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const uri = await StorageAccessFramework.createFileAsync(access.directoryUri, stem, mime);
  await StorageAccessFramework.writeAsStringAsync(uri, toBase64(bytes), { encoding: "base64" });
  return true;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}
