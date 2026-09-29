import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Client plugin storage for the desktop app: one JSON record per plugin under
// `<userData>/client-plugins/`. The renderer verifies signatures and hashes before it ever
// calls `put`; this module only persists records and reads dev-linked plugin folders.

const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
const MAX_RECORD_BYTES = 25 * 1024 * 1024;
const MAX_DEV_ENTRY_BYTES = 10 * 1024 * 1024;
const MANIFEST = "frogg-plugin.json";

function normalizeId(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !ID_PATTERN.test(value)) {
    throw new Error(`Invalid plugin id: ${String(value)}`);
  }
  return value;
}

function recordPath(baseDir: string, id: string): string {
  return path.join(baseDir, `${normalizeId(id)}.json`);
}

export function createClientPluginStore(baseDir: string) {
  return {
    async list(): Promise<unknown[]> {
      let names: string[];
      try {
        names = await readdir(baseDir);
      } catch {
        return [];
      }
      const out: unknown[] = [];
      for (const name of names) {
        if (!name.endsWith(".json") || !ID_PATTERN.test(name.slice(0, -5))) continue;
        try {
          out.push(JSON.parse(await readFile(path.join(baseDir, name), "utf8")));
        } catch {
          // A corrupt record is skipped; reinstalling overwrites it.
        }
      }
      return out;
    },
    async put(args: Record<string, unknown> | undefined): Promise<void> {
      const record = args?.record as { id?: unknown } | undefined;
      if (!record || typeof record !== "object") throw new Error("record is required");
      const file = recordPath(baseDir, normalizeId(record.id));
      const json = JSON.stringify(record);
      if (Buffer.byteLength(json) > MAX_RECORD_BYTES) throw new Error("Plugin record too large");
      await mkdir(baseDir, { recursive: true });
      const staging = `${file}.tmp-${process.pid}`;
      await writeFile(staging, json, "utf8");
      await rename(staging, file);
    },
    async remove(args: Record<string, unknown> | undefined): Promise<void> {
      await rm(recordPath(baseDir, normalizeId(args?.id)), { force: true });
    },
  };
}

function insideFolder(root: string, relative: string): string {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) {
    throw new Error(`entry.client must be a relative path inside the plugin: ${relative}`);
  }
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`entry.client escapes the plugin folder: ${relative}`);
  }
  return resolved;
}

/**
 * Reads a dev plugin folder: the raw manifest text and the client entry source. The renderer
 * validates the manifest; this only resolves paths safely and bounds sizes.
 */
export async function readClientPluginFolder(
  args: Record<string, unknown> | undefined,
): Promise<{ path: string; manifest: string; entrySource: string | null }> {
  const folder = args?.path;
  if (typeof folder !== "string" || !path.isAbsolute(folder)) {
    throw new Error("An absolute folder path is required");
  }
  const root = path.resolve(folder);
  const manifest = await readFile(path.join(root, MANIFEST), "utf8");
  let entry: unknown;
  try {
    entry = (JSON.parse(manifest) as { entry?: { client?: unknown } }).entry?.client;
  } catch {
    throw new Error(`${MANIFEST} is not JSON`);
  }
  if (typeof entry !== "string") return { path: root, manifest, entrySource: null };
  const entryFile = insideFolder(root, entry);
  const info = await stat(entryFile);
  if (info.size > MAX_DEV_ENTRY_BYTES) throw new Error("entry.client is too large");
  return { path: root, manifest, entrySource: await readFile(entryFile, "utf8") };
}
