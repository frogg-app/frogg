import { lstat, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type pino from "pino";
import { FROGG_TEMP_KINDS } from "./frogg-temp.js";
import { measureDirectory } from "./measure.js";

/**
 * Finds and removes scratch space earlier Frogg processes left behind. It is
 * deliberately narrow: only exact, Frogg-owned name patterns in known
 * locations, never through a symlink, never another user's entry, and never
 * anything a live process could still be using.
 */

export const DEFAULT_DEBRIS_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
/** A dead owner's scratch space must also be this old, so a pid that just exited mid-write is left alone. */
export const DEFAULT_DEAD_OWNER_GRACE_MS = 10 * 60 * 1000;
const CLASSIFY_HOME_MAX_ENTRIES = 1000;

export type DebrisKind = "temp" | "home_test_dir" | "clone_staging";

export interface DebrisCandidate {
  path: string;
  kind: DebrisKind;
}

export interface DebrisScanOptions {
  homeDir?: string;
  tmpRoot?: string;
  /** Directories that may hold interrupted `.frogg-clone-*` staging (parents of project roots). */
  stagingParents?: string[];
  /** Paths the current process is using; never returned. */
  protectedPaths?: string[];
  now?: number;
  staleAfterMs?: number;
  deadOwnerGraceMs?: number;
  isPidAlive?: (pid: number) => boolean;
  uid?: number | null;
  username?: string | null;
}

export interface DebrisRemovalResult {
  removed: string[];
  failed: string[];
  bytesFreed: number;
}

const KIND_ALTERNATION = FROGG_TEMP_KINDS.map((kind) => kind.replace(/-/g, "\\-")).join("|");
/** Current layout: `frogg-<kind>-<pid>-<unique>` (see frogg-temp.ts). */
const PID_TEMP_PATTERN = new RegExp(`^frogg-(?:${KIND_ALTERNATION})-(\\d+)-[A-Za-z0-9._-]+$`);
/** Pre-pid layout from `mkdtemp("frogg-<kind>-")`: exactly six random characters. */
const LEGACY_TEMP_PATTERN = /^frogg-(?:attachments|pi-mcp|pi-extension)-[A-Za-z0-9]{6}$/;
const ZSH_RUNTIME_PATTERN = /^(.+)-frogg-zsh-(\d+)$/;
const CLASSIFY_HOME_PATTERN = /^frogg-classify-home-[A-Za-z0-9]{6}$/;
const CLONE_STAGING_PATTERN = /^\.frogg-clone-[A-Za-z0-9]{6}$/;

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function currentUid(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function currentUsername(): string | null {
  try {
    return os.userInfo().username || null;
  } catch {
    return null;
  }
}

interface ResolvedScanOptions {
  now: number;
  staleAfterMs: number;
  deadOwnerGraceMs: number;
  isPidAlive: (pid: number) => boolean;
  uid: number | null;
  username: string | null;
  protectedPaths: Set<string>;
}

function resolveOptions(options: DebrisScanOptions): ResolvedScanOptions {
  return {
    now: options.now ?? Date.now(),
    staleAfterMs: options.staleAfterMs ?? DEFAULT_DEBRIS_STALE_AFTER_MS,
    deadOwnerGraceMs: options.deadOwnerGraceMs ?? DEFAULT_DEAD_OWNER_GRACE_MS,
    isPidAlive: options.isPidAlive ?? isPidAlive,
    uid: options.uid === undefined ? currentUid() : options.uid,
    username: options.username === undefined ? currentUsername() : options.username,
    protectedPaths: new Set((options.protectedPaths ?? []).map((p) => path.resolve(p))),
  };
}

async function listNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** lstat that rejects symlinks, other users' entries and protected paths. */
async function ownedEntry(
  fullPath: string,
  resolved: ResolvedScanOptions,
): Promise<{ ageMs: number; isDirectory: boolean } | null> {
  if (resolved.protectedPaths.has(path.resolve(fullPath))) return null;
  const stats = await lstat(fullPath).catch(() => null);
  if (!stats || stats.isSymbolicLink()) return null;
  if (!stats.isDirectory() && !stats.isFile()) return null;
  if (resolved.uid !== null && stats.uid !== resolved.uid) return null;
  return { ageMs: resolved.now - stats.mtimeMs, isDirectory: stats.isDirectory() };
}

/** Whether `name` is a Frogg-created temp entry at all, regardless of age or owner liveness. */
export function isFroggTempName(
  name: string,
  username: string | null = currentUsername(),
): boolean {
  if (PID_TEMP_PATTERN.test(name) || LEGACY_TEMP_PATTERN.test(name)) return true;
  const zsh = ZSH_RUNTIME_PATTERN.exec(name);
  return Boolean(zsh && username && zsh[1] === username);
}

/** Whether a Frogg temp entry name is eligible, given its age. Exported for tests. */
export function classifyTempName(
  name: string,
  ageMs: number,
  options: Pick<
    ResolvedScanOptions,
    "staleAfterMs" | "deadOwnerGraceMs" | "isPidAlive" | "username"
  >,
): boolean {
  const withPid = PID_TEMP_PATTERN.exec(name);
  if (withPid) {
    const pid = Number(withPid[1]);
    if (pid === process.pid || options.isPidAlive(pid)) return false;
    return ageMs >= options.deadOwnerGraceMs;
  }
  if (LEGACY_TEMP_PATTERN.test(name)) return ageMs >= options.staleAfterMs;
  const zsh = ZSH_RUNTIME_PATTERN.exec(name);
  if (zsh && options.username && zsh[1] === options.username) {
    const pid = Number(zsh[2]);
    if (pid === process.pid || options.isPidAlive(pid)) return false;
    return ageMs >= options.deadOwnerGraceMs;
  }
  return false;
}

async function scanTemp(tmpRoot: string, resolved: ResolvedScanOptions): Promise<string[]> {
  const found: string[] = [];
  for (const name of await listNames(tmpRoot)) {
    if (!name.includes("frogg-")) continue;
    const fullPath = path.join(tmpRoot, name);
    const entry = await ownedEntry(fullPath, resolved);
    if (entry && classifyTempName(name, entry.ageMs, resolved)) found.push(fullPath);
  }
  return found;
}

/** True when `dir` holds nothing but (nested) empty directories. Bounded; never follows links. */
export async function containsOnlyDirectories(dir: string): Promise<boolean> {
  let visited = 0;
  const pending = [dir];
  while (pending.length > 0) {
    const current = pending.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (++visited > CLASSIFY_HOME_MAX_ENTRIES) return false;
      if (!entry.isDirectory()) return false;
      pending.push(path.join(current, entry.name));
    }
  }
  return true;
}

async function scanHome(homeDir: string, resolved: ResolvedScanOptions): Promise<string[]> {
  const found: string[] = [];
  for (const name of await listNames(homeDir)) {
    if (!CLASSIFY_HOME_PATTERN.test(name)) continue;
    const fullPath = path.join(homeDir, name);
    const entry = await ownedEntry(fullPath, resolved);
    if (entry?.isDirectory && (await containsOnlyDirectories(fullPath))) found.push(fullPath);
  }
  return found;
}

async function scanStaging(parents: string[], resolved: ResolvedScanOptions): Promise<string[]> {
  const found: string[] = [];
  for (const parent of new Set(parents.map((p) => path.resolve(p)))) {
    for (const name of await listNames(parent)) {
      if (!CLONE_STAGING_PATTERN.test(name)) continue;
      const fullPath = path.join(parent, name);
      const entry = await ownedEntry(fullPath, resolved);
      // A clone times out after minutes; one idle for a day was interrupted.
      if (entry?.isDirectory && entry.ageMs >= resolved.staleAfterMs) found.push(fullPath);
    }
  }
  return found;
}

export async function findFroggDebris(options: DebrisScanOptions = {}): Promise<DebrisCandidate[]> {
  const resolved = resolveOptions(options);
  const [temp, home, staging] = await Promise.all([
    scanTemp(options.tmpRoot ?? os.tmpdir(), resolved),
    scanHome(options.homeDir ?? os.homedir(), resolved),
    scanStaging(options.stagingParents ?? [], resolved),
  ]);
  return [
    ...temp.map((p) => ({ path: p, kind: "temp" as const })),
    ...home.map((p) => ({ path: p, kind: "home_test_dir" as const })),
    ...staging.map((p) => ({ path: p, kind: "clone_staging" as const })),
  ];
}

export async function removeDebris(paths: string[]): Promise<DebrisRemovalResult> {
  const result: DebrisRemovalResult = { removed: [], failed: [], bytesFreed: 0 };
  for (const target of paths) {
    const size = await measureDirectory(target).catch(() => ({ bytes: 0 }));
    try {
      // rm removes symlinks inside the tree rather than following them.
      await rm(target, { recursive: true, force: true, maxRetries: 2 });
      result.removed.push(target);
      result.bytesFreed += size.bytes;
    } catch {
      result.failed.push(target);
    }
  }
  return result;
}

/** Startup sweep: never throws, logs what it removed. */
export async function sweepFroggDebris(
  options: DebrisScanOptions & { logger: pino.Logger },
): Promise<DebrisRemovalResult> {
  try {
    const candidates = await findFroggDebris(options);
    const result = await removeDebris(candidates.map((c) => c.path));
    if (result.removed.length > 0 || result.failed.length > 0) {
      options.logger.info(
        {
          removed: result.removed.length,
          failed: result.failed,
          bytesFreed: result.bytesFreed,
        },
        "Removed stale Frogg scratch files",
      );
    }
    return result;
  } catch (error) {
    options.logger.warn({ err: error }, "Stale Frogg scratch sweep failed");
    return { removed: [], failed: [], bytesFreed: 0 };
  }
}
