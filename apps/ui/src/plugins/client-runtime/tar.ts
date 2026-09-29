import { ClientPluginError } from "./errors";

// Browser-side reader for plugin tarballs (the deterministic ustar+gzip that `frogg plugins pack`
// writes, or npm-style `package/` tarballs). Same strictness as the daemon's reader: regular
// files only, no links or devices, no absolute or escaping paths, bounded sizes.

export interface TarFile {
  path: string;
  data: Uint8Array;
}

const BLOCK = 512;
export const MAX_CLIENT_TARBALL_BYTES = 20 * 1024 * 1024;
export const MAX_CLIENT_UNPACKED_BYTES = 80 * 1024 * 1024;
const MAX_FILES = 5000;

const decoder = new TextDecoder();

function readString(buf: Uint8Array, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return decoder.decode(nul === -1 ? slice : slice.subarray(0, nul));
}

function readOctal(buf: Uint8Array, offset: number, length: number): number {
  const s = readString(buf, offset, length).trim();
  return s ? parseInt(s, 8) : 0;
}

export function assertSafeTarPath(p: string): void {
  const bad = (reason: string) => new ClientPluginError("manifest_mismatch", `${reason}: ${p}`);
  if (!p || p.includes("\0") || p.includes("\\")) throw bad("unsafe path");
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) throw bad("absolute path");
  const segs = p.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.length === 0 || segs.some((s) => s === "..")) throw bad("path escapes plugin");
}

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "function") {
    throw new ClientPluginError("incompatible", "This app cannot decompress plugin tarballs");
  }
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CLIENT_UNPACKED_BYTES) {
      await reader.cancel();
      throw new ClientPluginError("manifest_mismatch", "Plugin tarball unpacks too large");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function parsePaxPath(data: Uint8Array): string | null {
  const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(decoder.decode(data));
  return m ? m[1]! : null;
}

/** Parses a .tgz into its regular files. */
export async function readTarGz(tgz: Uint8Array): Promise<TarFile[]> {
  if (tgz.byteLength > MAX_CLIENT_TARBALL_BYTES) {
    throw new ClientPluginError("manifest_mismatch", "Plugin tarball is too large");
  }
  let tar: Uint8Array;
  try {
    tar = await gunzip(tgz);
  } catch (error) {
    if (error instanceof ClientPluginError) throw error;
    throw new ClientPluginError("manifest_mismatch", "Plugin tarball is not valid gzip");
  }
  const files: TarFile[] = [];
  let offset = 0;
  let longName: string | null = null;
  while (offset + BLOCK <= tar.length) {
    const h = tar.subarray(offset, offset + BLOCK);
    if (h.every((b) => b === 0)) break;
    const size = readOctal(h, 124, 12);
    const type = readString(h, 156, 1) || "0";
    const prefix = readString(h, 345, 155);
    const rawName = readString(h, 0, 100);
    const body = tar.subarray(offset + BLOCK, offset + BLOCK + size);
    if (body.length !== size) throw new ClientPluginError("manifest_mismatch", "Truncated tarball");
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x" || type === "L") {
      longName = type === "x" ? parsePaxPath(body) : readString(body, 0, body.length);
      continue;
    }
    if (type === "g") continue;
    const name = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    longName = null;
    if (type === "5") continue;
    if (type !== "0") {
      throw new ClientPluginError("manifest_mismatch", `Unsupported tar entry ${name}`);
    }
    assertSafeTarPath(name);
    files.push({ path: name.replace(/^\.\//, ""), data: body.slice() });
    if (files.length > MAX_FILES) {
      throw new ClientPluginError("manifest_mismatch", "Too many files in tarball");
    }
  }
  if (files.length > 0 && files.every((f) => f.path.startsWith("package/"))) {
    return files.map((f) => ({ ...f, path: f.path.slice("package/".length) }));
  }
  return files;
}
