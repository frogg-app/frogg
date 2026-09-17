import { mkdirSync, symlinkSync, existsSync, lstatSync } from "node:fs";
import path from "node:path";

export interface ProvisionProviderAccountOptions {
  /** Primary config directory, e.g. `<home>/.claude`. */
  primaryDir: string;
  /** Account config directory, e.g. `<home>/.claude-peter`. */
  accountDir: string;
  /** Folders to link from the primary dir into the account dir. */
  linkFolders: readonly string[];
}

export interface ProvisionProviderAccountResult {
  /** Folders that are linked in the account dir after this run. */
  linkedFolders: string[];
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
 * Creates the account config directory and symlinks the shared sub-directories
 * back to the primary config directory.
 *
 * Idempotent: an existing account dir or an existing link is left alone. A
 * single link failure (missing source, or Windows without symlink privilege)
 * produces a warning instead of aborting — the account is still usable, it just
 * does not share that folder.
 */
export function provisionProviderAccount(
  options: ProvisionProviderAccountOptions,
): ProvisionProviderAccountResult {
  const { primaryDir, accountDir, linkFolders } = options;
  const warnings: string[] = [];
  const linkedFolders: string[] = [];

  mkdirSync(accountDir, { recursive: true });

  for (const folder of linkFolders) {
    const source = path.join(primaryDir, folder);
    const target = path.join(accountDir, folder);

    if (targetExists(target)) {
      // Already provisioned (or the user put something there); treat as linked.
      linkedFolders.push(folder);
      continue;
    }

    if (!existsSync(source)) {
      warnings.push(`Skipped "${folder}": ${source} does not exist.`);
      continue;
    }

    try {
      symlinkSync(source, target, "junction");
      linkedFolders.push(folder);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(
        `Could not link "${folder}" (${source} -> ${target}): ${message}. ` +
          "On Windows, symlink creation needs Developer Mode or an elevated shell.",
      );
    }
  }

  return { linkedFolders, warnings };
}
