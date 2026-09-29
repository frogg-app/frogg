// Minimal deterministic ustar + gzip, enough for plugin tarballs. We write our own rather
// than take a dependency so extraction can be strict: regular files and directories only,
// no links or devices, no absolute or parent-escaping paths, bounded sizes.
import { gunzipSync, gzipSync } from "node:zlib";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface TarEntry {
  /** POSIX relative path. */
  path: string;
  data: Uint8Array;
  mode?: number;
}

export class PluginTarError extends Error {}

const BLOCK = 512;
export const MAX_PLUGIN_TARBALL_BYTES = 50 * 1024 * 1024;
export const MAX_PLUGIN_UNPACKED_BYTES = 200 * 1024 * 1024;
export const MAX_PLUGIN_FILES = 5000;

function writeString(buf: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new PluginTarError(`tar field too long: ${value}`);
  bytes.copy(buf, offset);
}

function writeOctal(buf: Buffer, offset: number, length: number, value: number): void {
  writeString(buf, offset, length, value.toString(8).padStart(length - 1, "0") + "\0");
}

function splitName(name: string): { name: string; prefix: string } {
  if (Buffer.byteLength(name) <= 100) return { name, prefix: "" };
  const idx = name.lastIndexOf("/", 155);
  if (idx <= 0 || Buffer.byteLength(name.slice(idx + 1)) > 100) {
    throw new PluginTarError(`path too long for tar: ${name}`);
  }
  return { name: name.slice(idx + 1), prefix: name.slice(0, idx) };
}

function header(entryPath: string, size: number, mode: number, type: "0" | "5"): Buffer {
  const buf = Buffer.alloc(BLOCK);
  const { name, prefix } = splitName(entryPath);
  writeString(buf, 0, 100, name);
  writeOctal(buf, 100, 8, mode);
  writeOctal(buf, 108, 8, 0);
  writeOctal(buf, 116, 8, 0);
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, 0);
  buf.fill(0x20, 148, 156);
  writeString(buf, 156, 1, type);
  writeString(buf, 257, 6, "ustar\0");
  writeString(buf, 263, 2, "00");
  writeString(buf, 345, 155, prefix);
  let sum = 0;
  for (const byte of buf) sum += byte;
  writeString(buf, 148, 8, sum.toString(8).padStart(6, "0") + "\0 ");
  return buf;
}

/** Deterministic .tgz: entries sorted, zero mtime/uid/gid. */
export function createTarGz(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  const sorted = entries.toSorted((a, b) => a.path.localeCompare(b.path, "en"));
  for (const entry of sorted) {
    assertSafeEntryPath(entry.path);
    const data = Buffer.from(entry.data);
    parts.push(header(entry.path, data.length, entry.mode ?? 0o644, "0"), data);
    const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function assertSafeEntryPath(p: string): void {
  if (!p || p.includes("\0") || p.includes("\\")) throw new PluginTarError(`unsafe path: ${p}`);
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) throw new PluginTarError(`absolute path: ${p}`);
  const segs = p.split("/").filter((s) => s !== "" && s !== ".");
  if (segs.length === 0 || segs.some((s) => s === "..")) {
    throw new PluginTarError(`path escapes plugin directory: ${p}`);
  }
}

function readString(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? length : nul).toString("utf8");
}

function readOctal(buf: Buffer, offset: number, length: number): number {
  const s = readString(buf, offset, length).trim();
  return s ? parseInt(s, 8) : 0;
}

function parsePaxPath(data: Buffer): string | null {
  const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(data.toString("utf8"));
  return m ? m[1]! : null;
}

/** Parses a .tgz into file entries. Rejects links, devices and unsafe paths. */
export function readTarGz(tgz: Uint8Array): TarEntry[] {
  if (tgz.byteLength > MAX_PLUGIN_TARBALL_BYTES) throw new PluginTarError("tarball too large");
  let tar: Buffer;
  try {
    tar = gunzipSync(tgz, { maxOutputLength: MAX_PLUGIN_UNPACKED_BYTES });
  } catch (err) {
    throw new PluginTarError(`not a gzip tarball: ${(err as Error).message}`);
  }
  const entries: TarEntry[] = [];
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
    if (body.length !== size) throw new PluginTarError("truncated tarball");
    offset += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
    if (type === "x" || type === "L") {
      longName = type === "x" ? parsePaxPath(body) : readString(body, 0, body.length);
      continue;
    }
    if (type === "g") continue;
    const name = longName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    longName = null;
    if (type === "5") continue;
    if (type !== "0" && type !== "\0")
      throw new PluginTarError(`unsupported tar entry type "${type}" for ${name}`);
    // npm-style tarballs nest everything under package/.
    assertSafeEntryPath(name);
    entries.push({
      path: name.replace(/^\.\//, ""),
      data: Buffer.from(body),
      mode: readOctal(h, 100, 8),
    });
    if (entries.length > MAX_PLUGIN_FILES) throw new PluginTarError("too many files in tarball");
  }
  return stripCommonPackageDir(entries);
}

function stripCommonPackageDir(entries: TarEntry[]): TarEntry[] {
  if (entries.length > 0 && entries.every((e) => e.path.startsWith("package/"))) {
    return entries.map((e) => ({ ...e, path: e.path.slice("package/".length) }));
  }
  return entries;
}

export async function writeTarEntries(entries: TarEntry[], destDir: string): Promise<void> {
  const root = path.resolve(destDir);
  for (const entry of entries) {
    const target = path.resolve(root, ...entry.path.split("/"));
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new PluginTarError(`path escapes plugin directory: ${entry.path}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entry.data, { mode: (entry.mode ?? 0o644) & 0o755 });
  }
}
