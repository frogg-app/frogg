import { mkdirSync, symlinkSync, existsSync, lstatSync } from "node:fs";
import path from "node:path";

export interface ProvisionProviderAccountOptions {
  /** Primary config directory, e.g. `<home>/.claude`. */
  primaryDir: string;
  /** Account config directory, e.g. `<home>/.claude-peter`. */
  accountDir: string;
  /** Folders to link from the primary dir into the account dir. */
  linkFolders: readonly string[];
  /**
   * Home-mode only (`configDirMode: "home"`). When set, `accountDir` is a
   * synthetic HOME rather than a config directory: the provider's config dir is
   * created at `<accountDir>/<configSubdir>`, `linkFolders` are linked inside
   * that sub-directory, and `homeLinks` are linked from the real home into the
   * synthetic home so shared state stays reachable.
   */
  home?: {
    /** The daemon user's real home directory. */
    realHome: string;
    /** Config directory name inside the synthetic home, e.g. `.gemini`. */
    configSubdir: string;
    /** Home-relative entries to symlink back to `realHome`. */
    homeLinks: readonly string[];
  };
}

export interface ProvisionProviderAccountResult {
  /** Folders that are linked in the account dir after this run. */
  linkedFolders: string[];
  /**
   * Home-mode only: home-relative entries linked back to the real home. Kept
   * separate from `linkedFolders`, which is the provider's own shareable config
   * sub-directories and is validated against the capability's `linkableFolders`.
   */
  homeLinks: string[];
  /** Non-fatal problems. A failed link never fails the whole provisioning. */
  warnings: string[];
}

function targetExists(targetPath: string): boolean {
  // `existsSync` follows symlinks and reports false for a dangling link, which
  // would make provisioning try to re-create a link that is already there.
  try {
    lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Links `sourceRoot/entry` to `targetRoot/entry`, returning true when the link
 * is in place afterwards. Never throws: a missing source or an unprivileged
 * symlink call is a warning, because an account without one shared folder is
 * still a usable account.
 *
 * `entry` may contain separators (`.config/gcloud`), so the target's parent is
 * created first.
 */
function linkEntry(
  sourceRoot: string,
  targetRoot: string,
  entry: string,
  warnings: string[],
): boolean {
  const source = path.join(sourceRoot, entry);
  const target = path.join(targetRoot, entry);

  if (targetExists(target)) {
    // Already provisioned (or the user put something there); treat as linked.
    return true;
  }

  if (!existsSync(source)) {
    warnings.push(`Skipped "${entry}": ${source} does not exist.`);
    return false;
  }

  try {
    mkdirSync(path.dirname(target), { recursive: true });
    symlinkSync(source, target, "junction");
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(
      `Could not link "${entry}" (${source} -> ${target}): ${message}. ` +
        "On Windows, symlink creation needs Developer Mode or an elevated shell.",
    );
    return false;
  }
}

/**
 * Creates the account config directory and symlinks the shared sub-directories
 * back to the primary config directory.
 *
 * In home mode (`options.home`) the account directory is a synthetic HOME: the
 * provider's config directory is created one level down and the shared folders
 * are linked inside it, plus the home-relative `homeLinks` are linked back to
 * the real home.
 *
 * Idempotent: an existing account dir or an existing link is left alone. A
 * single link failure (missing source, or Windows without symlink privilege)
 * produces a warning instead of aborting — the account is still usable, it just
 * does not share that folder.
 */
export function provisionProviderAccount(
  options: ProvisionProviderAccountOptions,
): ProvisionProviderAccountResult {
  const { primaryDir, accountDir, linkFolders, home } = options;
  const warnings: string[] = [];
  const linkedFolders: string[] = [];
  const homeLinks: string[] = [];

  // In home mode the provider reads `<accountDir>/<configSubdir>`; the account
  // dir itself only exists to be a HOME.
  const configDir = home ? path.join(accountDir, home.configSubdir) : accountDir;
  mkdirSync(configDir, { recursive: true });

  for (const folder of linkFolders) {
    if (linkEntry(primaryDir, configDir, folder, warnings)) {
      linkedFolders.push(folder);
    }
  }

  if (home) {
    for (const entry of home.homeLinks) {
      if (linkEntry(home.realHome, accountDir, entry, warnings)) {
        homeLinks.push(entry);
      }
    }
  }

  return { linkedFolders, homeLinks, warnings };
}
