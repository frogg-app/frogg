import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { crc32, deflateRaw } from "zlib";
import { resolveExplorerFilePath } from "./service.js";

const deflate = promisify(deflateRaw);

/** Folders a download leaves out unless asked: dependencies, VCS data and build caches. */
export const ZIP_IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".venv",
  "__pycache__",
  ".gradle",
  ".next",
  ".turbo",
  ".expo",
]);

export interface ZipLimits {
  /** Most files one archive may hold. */
  maxFiles: number;
  /** Most uncompressed bytes one archive may hold; the archive is built in memory. */
  maxBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = { maxFiles: 20_000, maxBytes: 256 * 1024 * 1024 };

export interface ZipDirectoryParams {
  root: string;
  relativePath: string;
  includeIgnored?: boolean;
  limits?: ZipLimits;
  /** A folder or file this returns true for is left out (the daemon home, for one). */
  isProtected?: (absolutePath: string) => Promise<boolean>;
}

export interface ZipDirectoryResult {
  fileName: string;
  chunks: Buffer[];
  size: number;
  fileCount: number;
  /** Paths left out, relative to the zipped folder (folders end in "/"). */
  skipped: string[];
}

interface ZipFile {
  /** Path inside the archive, "/"-separated, under the folder's own name. */
  name: string;
  absolutePath: string;
  size: number;
  modifiedAt: Date;
}

/**
 * Zips a folder inside a checkout. Symlinks are never followed (they are listed as skipped),
 * and the walk stops with an error past `limits`, before reading any file contents.
 */
export async function zipDirectory(params: ZipDirectoryParams): Promise<ZipDirectoryResult> {
  const limits = params.limits ?? DEFAULT_ZIP_LIMITS;
  const directory = await resolveExplorerFilePath({
    root: params.root,
    relativePath: params.relativePath,
  });
  const stats = await fs.stat(directory);
  if (!stats.isDirectory()) throw new Error("Not a folder");
  const base = path.basename(directory) || "folder";
  const files: ZipFile[] = [];
  const folders: string[] = [];
  const skipped: string[] = [];
  let total = 0;

  const walk = async (absolute: string, relative: string): Promise<void> => {
    const entries = await fs.readdir(absolute, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length === 0 && relative) folders.push(relative);
    for (const entry of entries) {
      const childAbsolute = path.join(absolute, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) {
        skipped.push(childRelative);
        continue;
      }
      if (entry.isDirectory()) {
        if (
          (!params.includeIgnored && ZIP_IGNORED_DIRECTORIES.has(entry.name)) ||
          (await params.isProtected?.(childAbsolute))
        ) {
          skipped.push(`${childRelative}/`);
          continue;
        }
        await walk(childAbsolute, childRelative);
        continue;
      }
      if (!entry.isFile()) continue;
      const fileStats = await fs.stat(childAbsolute);
      total += fileStats.size;
      if (files.length + 1 > limits.maxFiles) {
        throw new Error(`Folder has more than ${limits.maxFiles.toLocaleString("en")} files`);
      }
      if (total > limits.maxBytes) {
        throw new Error(`Folder is larger than ${Math.round(limits.maxBytes / 1024 / 1024)} MB`);
      }
      files.push({
        name: childRelative,
        absolutePath: childAbsolute,
        size: fileStats.size,
        modifiedAt: fileStats.mtime,
      });
    }
  };
  if (await params.isProtected?.(directory))
    throw new Error("Access to this folder is not allowed");
  await walk(directory, "");

  const writer = new ZipWriter();
  for (const folder of folders) writer.addFolder(`${base}/${folder}/`, stats.mtime);
  for (const file of files) {
    await writer.addFile(
      `${base}/${file.name}`,
      await fs.readFile(file.absolutePath),
      file.modifiedAt,
    );
  }
  const chunks = writer.finish();
  return {
    fileName: `${base}.zip`,
    chunks,
    size: chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    fileCount: files.length,
    skipped,
  };
}

interface CentralEntry {
  name: Buffer;
  crc: number;
  method: number;
  compressedSize: number;
  size: number;
  time: number;
  date: number;
  offset: number;
  external: number;
}

/** A minimal zip writer (no zip64: the limits keep archives far below 4 GB). */
class ZipWriter {
  private readonly chunks: Buffer[] = [];
  private readonly central: CentralEntry[] = [];
  private offset = 0;

  addFolder(name: string, modifiedAt: Date): void {
    this.push(name, Buffer.alloc(0), 0, 0, 0, modifiedAt, 0o40755 << 16);
  }

  async addFile(name: string, data: Buffer, modifiedAt: Date): Promise<void> {
    const compressed = data.length > 0 ? await deflate(data) : data;
    // Already-compressed content (images, archives) is stored as is when deflate can't shrink it.
    const stored = compressed.length >= data.length;
    const body = stored ? data : compressed;
    this.push(name, body, stored ? 0 : 8, crc32(data), data.length, modifiedAt, 0o100644 << 16);
  }

  finish(): Buffer[] {
    const start = this.offset;
    for (const entry of this.central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(0x031e, 4); // made by: Unix, zip 3.0
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(0x0800, 8); // UTF-8 names
      header.writeUInt16LE(entry.method, 10);
      header.writeUInt16LE(entry.time, 12);
      header.writeUInt16LE(entry.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressedSize, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      header.writeUInt32LE(entry.external >>> 0, 38);
      header.writeUInt32LE(entry.offset, 42);
      this.write(header, entry.name);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.central.length, 8);
    end.writeUInt16LE(this.central.length, 10);
    end.writeUInt32LE(this.offset - start, 12);
    end.writeUInt32LE(start, 16);
    this.write(end);
    return this.chunks;
  }

  private push(
    name: string,
    body: Buffer,
    method: number,
    crc: number,
    size: number,
    modifiedAt: Date,
    external: number,
  ): void {
    const nameBytes = Buffer.from(name, "utf8");
    const { time, date } = dosDateTime(modifiedAt);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc >>> 0, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(size, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    this.central.push({
      name: nameBytes,
      crc: crc >>> 0,
      method,
      compressedSize: body.length,
      size,
      time,
      date,
      offset: this.offset,
      external,
    });
    this.write(header, nameBytes, body);
  }

  private write(...parts: Buffer[]): void {
    for (const part of parts) {
      if (part.length === 0) continue;
      this.chunks.push(part);
      this.offset += part.length;
    }
  }
}

function dosDateTime(value: Date): { time: number; date: number } {
  const year = Math.min(Math.max(value.getFullYear(), 1980), 2107);
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
  };
}
