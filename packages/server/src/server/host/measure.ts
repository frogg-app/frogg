import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MEASURE_MAX_ENTRIES = 200_000;
const STAT_BATCH = 64;

export interface DirectoryMeasurement {
  exists: boolean;
  bytes: number;
  entries: number;
  /** The walk stopped at `maxEntries`; `bytes` is a lower bound. */
  truncated: boolean;
}

/**
 * Apparent size of a file or tree. Asynchronous and batched so it never holds
 * the event loop, bounded by `maxEntries`, and it never follows symlinks.
 */
export async function measureDirectory(
  target: string,
  options: { maxEntries?: number } = {},
): Promise<DirectoryMeasurement> {
  const maxEntries = options.maxEntries ?? DEFAULT_MEASURE_MAX_ENTRIES;
  const root = await lstat(target).catch(() => null);
  if (!root) return { exists: false, bytes: 0, entries: 0, truncated: false };
  if (!root.isDirectory()) return { exists: true, bytes: root.size, entries: 1, truncated: false };

  let bytes = 0;
  let entries = 0;
  const pending = [target];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    const names = await readdir(dir).catch(() => [] as string[]);
    for (let i = 0; i < names.length; i += STAT_BATCH) {
      if (entries >= maxEntries) return { exists: true, bytes, entries, truncated: true };
      const batch = names.slice(i, i + STAT_BATCH).map((name) => path.join(dir, name));
      const stats = await Promise.all(batch.map((p) => lstat(p).catch(() => null)));
      stats.forEach((stat, index) => {
        if (!stat) return;
        entries += 1;
        if (stat.isDirectory()) pending.push(batch[index]!);
        else if (!stat.isSymbolicLink()) bytes += stat.size;
      });
    }
  }
  return { exists: true, bytes, entries, truncated: false };
}
