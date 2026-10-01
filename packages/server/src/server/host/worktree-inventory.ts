import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type pino from "pino";
import { runGitCommand } from "../../utils/run-git-command.js";
import { isPathInsideRoot } from "../../utils/path.js";
import { deleteFroggWorktree } from "../../utils/worktree.js";
import { measureDirectory } from "./measure.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_WORKTREE_RETENTION_DAYS = 7;
/** Merged worktrees go sooner: their commits already live on the default branch. */
const MERGED_GRACE_MS = DAY_MS;
const GIT_TIMEOUT_MS = 30_000;
const SWEEP_INITIAL_DELAY_MS = 5 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Sizing a worktree with node_modules is disk-bound; reuse a size for a while. */
const SIZE_CACHE_TTL_MS = 30 * 60 * 1000;
const CONCURRENCY = 6;

/**
 * Where a worktree came from. `frogg` lives under Frogg's worktrees root; every
 * other linked worktree of a known repository (Claude Code's
 * `.claude/worktrees/agent-*`, Codex's `~/.codex/worktrees`, hand-made ones)
 * is `external`.
 */
export type WorktreeOwner = "frogg" | "external";

export interface WorktreeEntry {
  path: string;
  repoRoot: string;
  owner: WorktreeOwner;
  branch: string | null;
  locked: boolean;
  /** Git still lists it but the directory is gone. */
  missing: boolean;
  /** Tracked changes or untracked, non-ignored files. Never removed automatically. */
  dirty: boolean;
  /** HEAD is contained in the repository's default branch. */
  merged: boolean;
  /** An active workspace or live agent runs inside it. */
  referenced: boolean;
  lastActivityAt: number;
  bytes: number;
  stale: boolean;
}

export interface WorktreeInventoryOptions {
  worktreesBaseRoot: string;
  froggHome?: string;
  /** Registered project roots. */
  listRepoRoots: () => Promise<string[]>;
  /** Provider config dirs (`~/.claude`, `~/.codex`, account dirs); their `worktrees/` is scanned. */
  listAccountDirs?: () => string[];
  /** Cwds of active workspaces and live agents. */
  listReferencedPaths: () => Promise<string[]>;
  retentionDays?: number;
  now?: () => number;
  logger: pino.Logger;
}

export interface WorktreeCleanupResult {
  bytesFreed: number;
  removed: string[];
}

export class WorktreeInventory {
  private readonly sizes = new Map<string, { at: number; bytes: number }>();

  constructor(private readonly options: WorktreeInventoryOptions) {}

  /** `measure: "stale"` sizes only removal candidates, which is all a sweep needs. */
  async list(options: { measure?: "all" | "stale" } = {}): Promise<WorktreeEntry[]> {
    const repoRoots = await this.discoverRepoRoots();
    const referenced = (await this.options.listReferencedPaths().catch(() => [])).map((p) =>
      path.resolve(p),
    );
    const found: Array<{ repoRoot: string; raw: RawWorktree }> = [];
    const seen = new Set<string>();
    for (const repoRoot of repoRoots) {
      for (const raw of await listLinkedWorktrees(repoRoot)) {
        if (seen.has(raw.path)) continue;
        seen.add(raw.path);
        found.push({ repoRoot, raw });
      }
    }
    const entries = await mapLimit(found, CONCURRENCY, ({ repoRoot, raw }) =>
      this.describe(repoRoot, raw, referenced),
    );
    const measureAll = options.measure !== "stale";
    await mapLimit(entries, CONCURRENCY, async (entry) => {
      if (!entry.missing && (measureAll || entry.stale))
        entry.bytes = await this.sizeOf(entry.path);
    });
    return entries;
  }

  private async sizeOf(target: string): Promise<number> {
    const now = Date.now();
    const cached = this.sizes.get(target);
    if (cached && now - cached.at < SIZE_CACHE_TTL_MS) return cached.bytes;
    const bytes = (await duBytes(target)) ?? (await measureDirectory(target)).bytes;
    this.sizes.set(target, { at: now, bytes });
    return bytes;
  }

  /** Removes every stale worktree. Branches are kept, so committed work survives. */
  async removeStale(owner?: WorktreeOwner): Promise<WorktreeCleanupResult> {
    const result: WorktreeCleanupResult = { bytesFreed: 0, removed: [] };
    for (const entry of await this.list({ measure: "stale" })) {
      if (!entry.stale || (owner && entry.owner !== owner)) continue;
      try {
        await this.remove(entry);
        this.sizes.delete(entry.path);
        result.bytesFreed += entry.bytes;
        result.removed.push(entry.path);
      } catch (error) {
        this.options.logger.warn(
          { err: error, path: entry.path },
          "Failed to remove stale worktree",
        );
      }
    }
    if (result.removed.length > 0) {
      this.options.logger.info(
        { removed: result.removed.length, bytesFreed: result.bytesFreed },
        "Removed stale worktrees",
      );
    }
    return result;
  }

  private async remove(entry: WorktreeEntry): Promise<void> {
    if (entry.missing) {
      await runGitCommand(["worktree", "prune"], {
        cwd: entry.repoRoot,
        timeout: GIT_TIMEOUT_MS,
      });
      return;
    }
    if (entry.owner === "frogg") {
      await deleteFroggWorktree({
        cwd: entry.repoRoot,
        worktreePath: entry.path,
        froggHome: this.options.froggHome,
        worktreesBaseRoot: this.options.worktreesBaseRoot,
      });
      return;
    }
    // No --force: git re-checks cleanliness and the lock, so a worktree that
    // changed since the scan is left alone.
    await runGitCommand(["worktree", "remove", entry.path], {
      cwd: entry.repoRoot,
      timeout: 120_000,
    });
  }

  private async describe(
    repoRoot: string,
    raw: RawWorktree,
    referencedPaths: string[],
  ): Promise<WorktreeEntry> {
    const now = this.options.now?.() ?? Date.now();
    const owner: WorktreeOwner = isPathInsideRoot(this.options.worktreesBaseRoot, raw.path)
      ? "frogg"
      : "external";
    const referenced = referencedPaths.some(
      (cwd) => cwd === raw.path || isPathInsideRoot(raw.path, cwd),
    );
    const base = {
      path: raw.path,
      repoRoot,
      owner,
      branch: raw.branch,
      locked: raw.locked,
      referenced,
    };
    if (raw.prunable || !(await lstat(raw.path).catch(() => null))) {
      return {
        ...base,
        missing: true,
        dirty: false,
        merged: false,
        lastActivityAt: 0,
        bytes: 0,
        stale: !raw.locked,
      };
    }

    const [dirty, merged, lastActivityAt] = await Promise.all([
      isDirty(raw.path),
      isMerged(repoRoot, raw.head),
      lastActivity(raw.path),
    ]);
    const idleMs = now - lastActivityAt;
    const retentionMs = (this.options.retentionDays ?? DEFAULT_WORKTREE_RETENTION_DAYS) * DAY_MS;
    // A detached HEAD that is not merged holds commits no branch keeps.
    const unreachableCommits = raw.branch === null && !merged;
    const stale =
      !raw.locked &&
      !referenced &&
      !dirty &&
      !unreachableCommits &&
      (merged ? idleMs >= MERGED_GRACE_MS : retentionMs > 0 && idleMs >= retentionMs);
    return {
      ...base,
      missing: false,
      dirty,
      merged,
      lastActivityAt,
      bytes: 0,
      stale,
    };
  }

  /** Registered projects plus the repositories behind worktrees found in scanned roots. */
  private async discoverRepoRoots(): Promise<string[]> {
    const roots = new Set(
      (await this.options.listRepoRoots().catch(() => [])).map((p) => path.resolve(p)),
    );
    const scanRoots = [
      this.options.worktreesBaseRoot,
      ...(this.options.listAccountDirs?.() ?? []).map((dir) => path.join(dir, "worktrees")),
    ];
    for (const scanRoot of scanRoots) {
      for (const candidate of await findWorktreeDirs(scanRoot, 2)) {
        const repoRoot = await mainRepoRootOf(candidate);
        if (repoRoot) roots.add(repoRoot);
      }
    }
    return [...roots];
  }
}

interface RawWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  locked: boolean;
  prunable: boolean;
}

/** Linked worktrees of `repoRoot`, excluding the main worktree. */
export async function listLinkedWorktrees(repoRoot: string): Promise<RawWorktree[]> {
  const result = await runGitCommand(["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
    timeout: GIT_TIMEOUT_MS,
  }).catch(() => null);
  if (!result) return [];
  return parseWorktreeList(result.stdout).slice(1);
}

export function parseWorktreeList(stdout: string): RawWorktree[] {
  const worktrees: RawWorktree[] = [];
  for (const block of stdout.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter(Boolean);
    const first = lines[0];
    if (!first?.startsWith("worktree ")) continue;
    const entry: RawWorktree = {
      path: path.resolve(first.slice("worktree ".length)),
      head: null,
      branch: null,
      locked: false,
      prunable: false,
    };
    for (const line of lines.slice(1)) {
      if (line.startsWith("HEAD ")) entry.head = line.slice(5);
      else if (line.startsWith("branch "))
        entry.branch = line.slice(7).replace(/^refs\/heads\//, "");
      else if (line === "locked" || line.startsWith("locked ")) entry.locked = true;
      else if (line === "prunable" || line.startsWith("prunable ")) entry.prunable = true;
      else if (line === "bare") entry.prunable = false;
    }
    worktrees.push(entry);
  }
  return worktrees;
}

async function isDirty(worktree: string): Promise<boolean> {
  const result = await runGitCommand(["status", "--porcelain", "--untracked-files=normal"], {
    cwd: worktree,
    timeout: GIT_TIMEOUT_MS,
  }).catch(() => null);
  // Unknown state counts as dirty so it is never removed.
  return result === null || result.stdout.trim().length > 0;
}

async function isMerged(repoRoot: string, head: string | null): Promise<boolean> {
  if (!head) return false;
  for (const ref of await defaultBranchRefs(repoRoot)) {
    const result = await runGitCommand(["merge-base", "--is-ancestor", head, ref], {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT_MS,
      acceptExitCodes: [0, 1],
    }).catch(() => null);
    if (result?.exitCode === 0) return true;
  }
  return false;
}

async function defaultBranchRefs(repoRoot: string): Promise<string[]> {
  const refs: string[] = [];
  const originHead = await runGitCommand(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { cwd: repoRoot, timeout: GIT_TIMEOUT_MS, acceptExitCodes: [0, 1] },
  ).catch(() => null);
  const remote = originHead?.exitCode === 0 ? originHead.stdout.trim() : "";
  if (remote) refs.push(remote, remote.replace(/^origin\//, ""));
  refs.push("main", "master");
  const existing: string[] = [];
  for (const ref of new Set(refs)) {
    const verified = await runGitCommand(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      cwd: repoRoot,
      timeout: GIT_TIMEOUT_MS,
      acceptExitCodes: [0, 1],
    }).catch(() => null);
    if (verified?.exitCode === 0) existing.push(ref);
  }
  return existing;
}

/** Latest touch of the worktree's git admin files or its root directory. */
async function lastActivity(worktree: string): Promise<number> {
  const candidates = [worktree];
  const gitDir = await readGitDir(worktree);
  if (gitDir) {
    candidates.push(
      path.join(gitDir, "HEAD"),
      path.join(gitDir, "index"),
      path.join(gitDir, "logs", "HEAD"),
    );
  }
  let latest = 0;
  for (const candidate of candidates) {
    const stat = await lstat(candidate).catch(() => null);
    if (stat) latest = Math.max(latest, stat.mtimeMs);
  }
  return latest;
}

async function readGitDir(worktree: string): Promise<string | null> {
  const content = await readFile(path.join(worktree, ".git"), "utf8").catch(() => null);
  const match = content?.match(/^gitdir:\s*(.+)$/m);
  if (!match?.[1]) return null;
  return path.resolve(worktree, match[1].trim());
}

async function mainRepoRootOf(worktree: string): Promise<string | null> {
  const gitDir = await readGitDir(worktree);
  if (!gitDir) return null;
  // <common>/.git/worktrees/<name>
  const commonDir = path.dirname(path.dirname(gitDir));
  if (path.basename(path.dirname(gitDir)) !== "worktrees") return null;
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
}

/** Disk usage via `du`, far faster than a JS walk on large trees; null where unavailable. */
function duBytes(target: string): Promise<number | null> {
  if (process.platform === "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile("du", ["-sk", target], { timeout: 300_000 }, (error, stdout) => {
      const kib = Number.parseInt(stdout?.split(/\s/)[0] ?? "", 10);
      // du exits non-zero on unreadable subdirs but still prints a total.
      if (Number.isFinite(kib)) resolve(kib * 1024);
      else resolve(error ? null : 0);
    });
  });
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Directories holding a `.git` file, up to `depth` levels below `root`. */
async function findWorktreeDirs(root: string, depth: number): Promise<string[]> {
  const found: string[] = [];
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const dotGit = await lstat(path.join(dir, ".git")).catch(() => null);
    if (dotGit?.isFile()) found.push(dir);
    else if (depth > 1) found.push(...(await findWorktreeDirs(dir, depth - 1)));
  }
  return found;
}

/** Removes stale worktrees shortly after start, then every few hours. Returns a stop function. */
export function startStaleWorktreeSweep(
  inventory: WorktreeInventory,
  options: { enabled: boolean; logger: pino.Logger },
): () => void {
  if (!options.enabled) return () => undefined;
  let timer: NodeJS.Timeout;
  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      void inventory
        .removeStale()
        .catch((error) => options.logger.warn({ err: error }, "Stale worktree sweep failed"))
        .finally(() => schedule(SWEEP_INTERVAL_MS));
    }, delay);
    timer.unref();
  };
  schedule(SWEEP_INITIAL_DELAY_MS);
  return () => clearTimeout(timer);
}
