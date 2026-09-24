import { promises as fs } from "node:fs";
import path from "node:path";
import { expandUserPath, isSameOrDescendantPath, resolvePathFromBase } from "../path-utils.js";
import { resolveFroggWorktreesBaseRoot } from "../../utils/worktree.js";

export const DAEMON_HOME_ACCESS_DENIED_MESSAGE = "Access to the daemon home is not allowed";

/**
 * Resolves a path to its canonical location, following symlinks. A missing
 * tail is resolved against the realpath of its nearest existing ancestor, so a
 * not-yet-created entry under a symlinked directory is still placed correctly.
 */
export async function canonicalizePath(target: string): Promise<string> {
  const absolute = path.resolve(target);
  const missing: string[] = [];
  let current = absolute;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return missing.length === 0 ? real : path.join(real, ...missing.toReversed());
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export interface DaemonHomeGuardOptions {
  froggHome: string;
  /** Configured worktrees root; defaults to `<froggHome>/worktrees`. */
  worktreesRoot?: string;
}

/**
 * Keeps the daemon's own state (keypair, local token, principals, config)
 * out of reach of file RPCs and downloads for every role. Frogg-owned
 * worktrees live under the home by default, so the worktrees root is carved
 * back out.
 */
export class DaemonHomeGuard {
  private readonly froggHome: string;
  private readonly worktreesRoot: string;

  constructor(options: DaemonHomeGuardOptions) {
    this.froggHome = path.resolve(options.froggHome);
    this.worktreesRoot = resolveFroggWorktreesBaseRoot({
      froggHome: options.froggHome,
      worktreesRoot: options.worktreesRoot,
    });
  }

  async isProtected(target: string): Promise<boolean> {
    const canonical = await canonicalizePath(target);
    const home = await canonicalizePath(this.froggHome);
    if (!isSameOrDescendantPath(home, canonical)) return false;
    const worktrees = await canonicalizePath(this.worktreesRoot);
    return !(worktrees !== home && isSameOrDescendantPath(worktrees, canonical));
  }

  /** Throws when `cwd` joined with any of `relativePaths` lands in the daemon home. */
  async assertAccessible(cwd: string, ...relativePaths: string[]): Promise<void> {
    const base = expandUserPath(cwd);
    const targets = relativePaths.length > 0 ? relativePaths : ["."];
    for (const relativePath of targets) {
      if (await this.isProtected(resolvePathFromBase(base, relativePath))) {
        throw new Error(DAEMON_HOME_ACCESS_DENIED_MESSAGE);
      }
    }
  }
}
