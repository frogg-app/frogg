import { lstat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type pino from "pino";
import {
  findFroggDebris,
  isFroggTempName,
  removeDebris,
  type DebrisScanOptions,
} from "./debris-sweep.js";
import { measureDirectory, type DirectoryMeasurement } from "./measure.js";
import type { WorktreeEntry, WorktreeInventory, WorktreeOwner } from "./worktree-inventory.js";

/**
 * Stable wire ids for the storage Frogg owns. Clients key labels and actions
 * off these; add new ids rather than renaming.
 */
export const STORAGE_CATEGORY_IDS = [
  "logs",
  "agents",
  "projects",
  "worktrees",
  "agent_worktrees",
  "provider_accounts",
  "uploads",
  "project_import_staging",
  "tts_cache",
  "models",
  "daemon_versions",
  "temp",
] as const;
export type StorageCategoryId = (typeof STORAGE_CATEGORY_IDS)[number];

/** Categories the cleanup RPC accepts; everything else is size-only. */
export const CLEANABLE_STORAGE_CATEGORIES: ReadonlySet<StorageCategoryId> = new Set([
  "logs",
  "worktrees",
  "agent_worktrees",
  "tts_cache",
  "temp",
]);

export interface StorageCategory {
  id: StorageCategoryId;
  path: string | null;
  exists: boolean;
  bytes: number;
  entryCount: number;
  truncated: boolean;
  cleanable: boolean;
  /** What cleanup would free now; null for size-only categories. */
  reclaimableBytes: number | null;
}

export interface OwnedStorageReport {
  computedAt: string;
  categories: StorageCategory[];
}

export interface StorageCleanupResult {
  categoryId: StorageCategoryId;
  bytesFreed: number;
  removedCount: number;
}

/** Rotated daemon logs: `YYYYMMDD-HHMM-NN-daemon.log` and `daemon.log.<n>`. Never the live `daemon.log`. */
const ROTATED_LOG_PATTERN = /^(?:\d{8}-\d{4}-\d{2}-daemon\.log|daemon\.log\.\d+)$/;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

export interface OwnedStorageOptions {
  froggHome: string;
  worktreesRoot?: string;
  /** `<installDir>/versions` for a versioned install, else null. */
  versionsDir?: string | null;
  tmpRoot?: string;
  homeDir?: string;
  /** Parents of registered project roots, where interrupted clone staging can sit. */
  listStagingParents?: () => Promise<string[]>;
  /** Paths this process is using right now (e.g. its attachment directory). */
  listProtectedPaths?: () => string[];
  /** Linked worktrees of known repositories; stale ones are what worktree cleanup removes. */
  worktreeInventory?: WorktreeInventory;
  /** Provider config dirs, default (`~/.claude`) and per-account. */
  listProviderAccountDirs?: () => string[];
  cacheTtlMs?: number;
  logger: pino.Logger;
}

export class OwnedStorageService {
  private cached: { at: number; report: OwnedStorageReport } | null = null;
  private inflight: Promise<OwnedStorageReport> | null = null;
  private cleanupQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: OwnedStorageOptions) {}

  async list(options: { refresh?: boolean } = {}): Promise<OwnedStorageReport> {
    const ttl = this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (!options.refresh && this.cached && Date.now() - this.cached.at < ttl) {
      return this.cached.report;
    }
    this.inflight ??= this.compute().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  cleanup(categoryId: string): Promise<StorageCleanupResult> {
    const run = this.cleanupQueue.then(() => this.runCleanup(categoryId));
    this.cleanupQueue = run.catch(() => undefined);
    return run;
  }

  /** Parents of registered project roots; empty when the registry cannot be read. */
  async listStagingParents(): Promise<string[]> {
    return (await this.options.listStagingParents?.().catch(() => [])) ?? [];
  }

  private tmpRoot(): string {
    return this.options.tmpRoot ?? os.tmpdir();
  }

  private debrisOptions = async (): Promise<DebrisScanOptions> => ({
    tmpRoot: this.tmpRoot(),
    homeDir: this.options.homeDir ?? os.homedir(),
    stagingParents: await this.listStagingParents(),
    protectedPaths: this.options.listProtectedPaths?.() ?? [],
  });

  private async runCleanup(categoryId: string): Promise<StorageCleanupResult> {
    if (!isStorageCategoryId(categoryId) || !CLEANABLE_STORAGE_CATEGORIES.has(categoryId)) {
      throw new Error(`Storage category is not cleanable: ${categoryId}`);
    }
    const owner = worktreeOwnerFor(categoryId);
    if (owner) {
      const removed = (await this.options.worktreeInventory?.removeStale(owner)) ?? {
        bytesFreed: 0,
        removed: [],
      };
      this.cached = null;
      return {
        categoryId,
        bytesFreed: removed.bytesFreed,
        removedCount: removed.removed.length,
      };
    }
    const paths = await this.cleanablePaths(categoryId);
    const result = await removeDebris(paths);
    this.cached = null;
    this.options.logger.info(
      {
        categoryId,
        removed: result.removed.length,
        bytesFreed: result.bytesFreed,
      },
      "Cleaned Frogg storage",
    );
    return {
      categoryId,
      bytesFreed: result.bytesFreed,
      removedCount: result.removed.length,
    };
  }

  private async cleanablePaths(categoryId: StorageCategoryId): Promise<string[]> {
    if (categoryId === "logs") return this.rotatedLogPaths();
    if (categoryId === "tts_cache") {
      return listRegularFiles(path.join(this.options.froggHome, "tts-cache"));
    }
    if (categoryId === "temp") {
      return (await findFroggDebris(await this.debrisOptions())).map((c) => c.path);
    }
    return [];
  }

  private async rotatedLogPaths(): Promise<string[]> {
    const dirs = [this.options.froggHome, path.join(this.options.froggHome, "logs")];
    const found: string[] = [];
    for (const dir of dirs) {
      for (const file of await listRegularFiles(dir)) {
        if (ROTATED_LOG_PATTERN.test(path.basename(file))) found.push(file);
      }
    }
    return found;
  }

  private async compute(): Promise<OwnedStorageReport> {
    const home = this.options.froggHome;
    const dir = (id: StorageCategoryId, target: string | null) => this.measureCategory(id, target);
    const worktrees =
      (await this.options.worktreeInventory?.list().catch((error) => {
        this.options.logger.warn({ err: error }, "Failed to list worktrees");
        return null;
      })) ?? [];
    const worktreesRoot = this.options.worktreesRoot ?? path.join(home, "worktrees");
    const categories = await Promise.all([
      this.measureLogs(),
      dir("agents", path.join(home, "agents")),
      dir("projects", path.join(home, "projects")),
      this.measureCategory("worktrees", worktreesRoot).then((category) => ({
        ...category,
        reclaimableBytes: staleBytes(worktrees, "frogg"),
      })),
      this.measureAgentWorktrees(worktrees),
      this.measureProviderAccounts(),
      dir("uploads", path.join(home, "uploads")),
      dir("project_import_staging", path.join(home, "project-import-staging")),
      this.measureCategory("tts_cache", path.join(home, "tts-cache"), "all"),
      dir("models", path.join(home, "models")),
      dir("daemon_versions", this.options.versionsDir ?? null),
      this.measureTemp(),
    ]);
    const report = { computedAt: new Date().toISOString(), categories };
    this.cached = { at: Date.now(), report };
    return report;
  }

  private async measureCategory(
    id: StorageCategoryId,
    target: string | null,
    reclaim?: "all",
  ): Promise<StorageCategory> {
    const measured: DirectoryMeasurement = target
      ? await measureDirectory(target)
      : { exists: false, bytes: 0, entries: 0, truncated: false };
    return toCategory(id, target, measured, reclaim === "all" ? measured.bytes : null);
  }

  private async measureAgentWorktrees(worktrees: WorktreeEntry[]): Promise<StorageCategory> {
    const external = worktrees.filter((entry) => entry.owner === "external");
    return {
      id: "agent_worktrees",
      path: null,
      exists: external.length > 0,
      bytes: external.reduce((sum, entry) => sum + entry.bytes, 0),
      entryCount: external.length,
      truncated: false,
      cleanable: true,
      reclaimableBytes: staleBytes(worktrees, "external"),
    };
  }

  private async measureProviderAccounts(): Promise<StorageCategory> {
    const dirs = [...new Set(this.options.listProviderAccountDirs?.() ?? [])];
    let bytes = 0;
    let entries = 0;
    let truncated = false;
    let exists = false;
    for (const dir of dirs) {
      const measured = await measureDirectory(dir);
      exists ||= measured.exists;
      bytes += measured.bytes;
      entries += measured.entries;
      truncated ||= measured.truncated;
    }
    return toCategory(
      "provider_accounts",
      dirs.length === 1 ? dirs[0]! : null,
      { exists, bytes, entries, truncated },
      null,
    );
  }

  private async measureLogs(): Promise<StorageCategory> {
    const home = this.options.froggHome;
    const topLevel = (await listRegularFiles(home)).filter((file) => {
      const name = path.basename(file);
      return name === "daemon.log" || ROTATED_LOG_PATTERN.test(name);
    });
    const logsDir = await measureDirectory(path.join(home, "logs"));
    const rotated = new Set(await this.rotatedLogPaths());
    let bytes = logsDir.bytes;
    let reclaimable = 0;
    for (const file of topLevel) bytes += (await sizeOf(file)) ?? 0;
    for (const file of rotated) reclaimable += (await sizeOf(file)) ?? 0;
    return {
      id: "logs",
      path: home,
      exists: true,
      bytes,
      entryCount: topLevel.length + logsDir.entries,
      truncated: logsDir.truncated,
      cleanable: true,
      reclaimableBytes: reclaimable,
    };
  }

  private async measureTemp(): Promise<StorageCategory> {
    const root = this.tmpRoot();
    const names = (await readdir(root).catch(() => [] as string[])).filter((name) =>
      isFroggTempName(name),
    );
    const uid = typeof process.getuid === "function" ? process.getuid() : null;
    let bytes = 0;
    let entries = 0;
    let truncated = false;
    for (const name of names) {
      const full = path.join(root, name);
      const stat = await lstat(full).catch(() => null);
      if (!stat || stat.isSymbolicLink() || (uid !== null && stat.uid !== uid)) continue;
      const measured = await measureDirectory(full, { maxEntries: 20_000 });
      bytes += measured.bytes;
      entries += measured.entries;
      truncated ||= measured.truncated;
    }
    let reclaimable = 0;
    for (const candidate of await findFroggDebris(await this.debrisOptions())) {
      reclaimable += (await measureDirectory(candidate.path, { maxEntries: 20_000 })).bytes;
    }
    return {
      id: "temp",
      path: root,
      exists: true,
      bytes,
      entryCount: entries,
      truncated,
      cleanable: true,
      reclaimableBytes: reclaimable,
    };
  }
}

function toCategory(
  id: StorageCategoryId,
  target: string | null,
  measured: DirectoryMeasurement,
  reclaimableBytes: number | null,
): StorageCategory {
  const cleanable = CLEANABLE_STORAGE_CATEGORIES.has(id);
  return {
    id,
    path: target,
    exists: measured.exists,
    bytes: measured.bytes,
    entryCount: measured.entries,
    truncated: measured.truncated,
    cleanable,
    reclaimableBytes: cleanable ? (reclaimableBytes ?? 0) : null,
  };
}

function worktreeOwnerFor(categoryId: StorageCategoryId): WorktreeOwner | null {
  if (categoryId === "worktrees") return "frogg";
  if (categoryId === "agent_worktrees") return "external";
  return null;
}

function staleBytes(worktrees: WorktreeEntry[], owner: WorktreeOwner): number {
  return worktrees
    .filter((entry) => entry.owner === owner && entry.stale)
    .reduce((sum, entry) => sum + entry.bytes, 0);
}

export function isStorageCategoryId(value: string): value is StorageCategoryId {
  return (STORAGE_CATEGORY_IDS as readonly string[]).includes(value);
}

async function listRegularFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(dir, entry.name));
}

async function sizeOf(file: string): Promise<number | null> {
  const stat = await lstat(file).catch(() => null);
  return stat?.isFile() ? stat.size : null;
}
