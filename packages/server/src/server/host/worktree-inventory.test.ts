import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorktreeInventory, parseWorktreeList } from "./worktree-inventory.js";

const DAY_MS = 24 * 60 * 60 * 1000;
let root: string;
let repo: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function addWorktree(name: string, branch: string): string {
  const dir = path.join(repo, ".claude", "worktrees", name);
  git(repo, "worktree", "add", "-q", "-b", branch, dir);
  return dir;
}

function inventory(options: { now?: number; referenced?: string[] } = {}): WorktreeInventory {
  return new WorktreeInventory({
    worktreesBaseRoot: path.join(root, "frogg-worktrees"),
    listRepoRoots: async () => [repo],
    listReferencedPaths: async () => options.referenced ?? [],
    now: () => options.now ?? Date.now(),
    logger: pino({ level: "silent" }),
  });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "worktree-inventory-test-")));
  repo = path.join(root, "repo");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  writeFileSync(path.join(repo, "a.txt"), "a");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "init");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("WorktreeInventory", () => {
  it("marks merged, clean, unreferenced worktrees stale after the grace period", async () => {
    const dir = addWorktree("agent-merged", "merged");
    const [fresh] = await inventory().list();
    expect(fresh).toMatchObject({
      path: dir,
      owner: "external",
      merged: true,
      stale: false,
    });

    const [later] = await inventory({ now: Date.now() + 2 * DAY_MS }).list();
    expect(later?.stale).toBe(true);
  });

  it("keeps unmerged worktrees until retention elapses", async () => {
    const dir = addWorktree("agent-work", "work");
    writeFileSync(path.join(dir, "b.txt"), "b");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "work");

    const [soon] = await inventory({ now: Date.now() + 2 * DAY_MS }).list();
    expect(soon).toMatchObject({ merged: false, stale: false });
    const [late] = await inventory({ now: Date.now() + 8 * DAY_MS }).list();
    expect(late?.stale).toBe(true);
  });

  it("never marks dirty, referenced or locked worktrees stale", async () => {
    const dirty = addWorktree("agent-dirty", "dirty");
    writeFileSync(path.join(dirty, "untracked.txt"), "x");
    const used = addWorktree("agent-used", "used");
    const locked = addWorktree("agent-locked", "locked");
    git(repo, "worktree", "lock", locked);

    const entries = await inventory({
      now: Date.now() + 30 * DAY_MS,
      referenced: [path.join(used, "sub")],
    }).list();
    expect(entries.map((entry) => entry.stale)).toEqual([false, false, false]);
    expect(entries.find((entry) => entry.path === dirty)?.dirty).toBe(true);
    expect(entries.find((entry) => entry.path === used)?.referenced).toBe(true);
  });

  it("removes stale worktrees and keeps their branches", async () => {
    const dir = addWorktree("agent-done", "done");
    const result = await inventory({
      now: Date.now() + 2 * DAY_MS,
    }).removeStale();
    expect(result.removed).toEqual([dir]);
    expect(existsSync(dir)).toBe(false);
    expect(git(repo, "branch", "--list", "done").trim()).toContain("done");
  });

  it("discovers repositories from worktrees under account dirs", async () => {
    const accountDir = path.join(root, "codex");
    const dir = path.join(accountDir, "worktrees", "abc", "repo");
    git(repo, "worktree", "add", "-q", "-b", "codex", dir);
    const entries = await new WorktreeInventory({
      worktreesBaseRoot: path.join(root, "frogg-worktrees"),
      listRepoRoots: async () => [],
      listAccountDirs: () => [accountDir],
      listReferencedPaths: async () => [],
      logger: pino({ level: "silent" }),
    }).list();
    expect(entries.map((entry) => entry.path)).toEqual([dir]);
  });
});

describe("parseWorktreeList", () => {
  it("parses porcelain output", () => {
    const parsed = parseWorktreeList(
      "worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r/w\nHEAD bbb\ndetached\nlocked reason\nprunable gitdir file points to non-existent location\n",
    );
    expect(parsed).toEqual([
      {
        path: path.resolve("/r"),
        head: "aaa",
        branch: "main",
        locked: false,
        prunable: false,
      },
      {
        path: path.resolve("/r/w"),
        head: "bbb",
        branch: null,
        locked: true,
        prunable: true,
      },
    ]);
  });
});
