// COMPAT(skillsRemoved): the daemon used to install its own skills into the
// provider skill folders. That stopped in 1.5.43; this removes the copies it
// left behind. Remove after 2027-09-24.
//
// A directory is removed only when it still holds exactly what the daemon
// wrote: its ownership manifest names this brand and every file on disk is
// listed there with an unchanged hash. Anything the user added or edited keeps
// the whole directory in place.
import { brand } from "@frogg/branding";
import { matchesBrand } from "@frogg/branding/identity";
import { installedSkillName } from "@frogg/branding/skills";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const MANAGED_FILES_MANIFEST = ".frogg-managed-files.json";

/** Every skill name the daemon ever installed. */
export const RETIRED_SKILL_NAMES = [
  "frogg",
  "frogg-advisor",
  "frogg-build-monitor",
  "frogg-chat",
  "frogg-committee",
  "frogg-dev",
  "frogg-docs",
  "frogg-epic",
  "frogg-handoff",
  "frogg-help",
  "frogg-i18n",
  "frogg-orchestrate",
  "frogg-orchestrator",
  "frogg-release",
  "frogg-rpc",
] as const;

export function retiredSkillRoots(home: string = os.homedir()): string[] {
  return [
    path.join(home, ".agents", "skills"),
    path.join(home, ".claude", "skills"),
    path.join(home, ".codex", "skills"),
  ];
}

async function listFiles(root: string, relative = ""): Promise<string[] | null> {
  const out: string[] = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFiles(root, rel);
      if (nested === null) return null;
      out.push(...nested);
    } else if (entry.isFile()) {
      out.push(rel.split(path.sep).join("/"));
    } else {
      return null;
    }
  }
  return out;
}

async function isUntouchedInstall(directory: string): Promise<boolean> {
  const stat = await fs.lstat(directory).catch(() => null);
  if (!stat?.isDirectory()) return false;
  const raw = await fs
    .readFile(path.join(directory, MANAGED_FILES_MANIFEST), "utf8")
    .catch(() => null);
  if (raw === null) return false;
  let manifest: { brand?: unknown; files?: unknown };
  try {
    manifest = JSON.parse(raw) as typeof manifest;
  } catch {
    return false;
  }
  if (!matchesBrand(brand, manifest.brand)) return false;
  if (typeof manifest.files !== "object" || manifest.files === null) return false;
  const expected = manifest.files as Record<string, unknown>;
  const files = await listFiles(directory);
  if (files === null) return false;
  for (const rel of files) {
    if (rel === MANAGED_FILES_MANIFEST) continue;
    // Older installs keyed the manifest with native separators.
    const hash = expected[rel] ?? expected[rel.split("/").join(path.sep)];
    if (typeof hash !== "string") return false;
    const actual = createHash("sha256")
      .update(await fs.readFile(path.join(directory, rel)))
      .digest("hex");
    if (actual !== hash) return false;
  }
  return true;
}

/** Removes untouched daemon-installed skills; returns the directories removed. */
export async function removeRetiredSkills(roots = retiredSkillRoots()): Promise<string[]> {
  const removed: string[] = [];
  for (const root of roots) {
    for (const name of RETIRED_SKILL_NAMES) {
      const directory = path.join(root, installedSkillName(brand, name));
      if (!(await isUntouchedInstall(directory))) continue;
      await fs.rm(directory, { recursive: true, force: true });
      removed.push(directory);
    }
  }
  return removed;
}
