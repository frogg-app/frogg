#!/usr/bin/env node
// Release streams CLI: cut betas, promote a beta line to stable, backport fixes, pull upstream
// into a fork and send fork changes back upstream. `npm run streams -- help` lists commands.
// website/src/content/docs/docs/contributing/release-streams.mdx is the user guide.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  branchForVersion,
  channelForBranch,
  readStreamsConfig,
  upstreamFollowRef,
} from "./streams-config.mjs";
import {
  assertStablePatch,
  isReleaseCutSubject,
  isVersionOwnedFile,
  nextBetaVersion,
  promotionVersion,
} from "./streams-core.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function git(args, options = {}) {
  execFileSync("git", args, { cwd: options.cwd ?? rootDir, stdio: "inherit" });
}
function gitOut(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd ?? rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", options.quiet ? "ignore" : "inherit"],
  }).trim();
}
function gitTry(args) {
  const result = spawnSync("git", args, { cwd: rootDir, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}
function npm(args) {
  execFileSync("npm", args, { cwd: rootDir, stdio: "inherit" });
}
function fail(message) {
  process.stderr.write(`\n${message}\n`);
  process.exit(1);
}

function currentBranch() {
  return gitOut(["branch", "--show-current"]);
}
function assertOnBranch(branch, what) {
  const current = currentBranch();
  if (current !== branch) fail(`${what} runs on ${branch}; you are on ${current || "(detached)"}.`);
}
function assertClean() {
  if (gitOut(["status", "--porcelain"])) fail("Commit or set aside your changes first.");
}
function refExists(ref) {
  return gitTry(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]) !== null;
}
function readVersion(ref) {
  const text = gitTry(["show", `${ref}:package.json`]);
  return text ? JSON.parse(text).version : null;
}
function fetchOrigin(...branches) {
  for (const branch of branches) {
    gitTry(["fetch", "--quiet", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
  }
  gitTry(["fetch", "--quiet", "--tags", "origin"]);
}
function newestStableTag(ref) {
  const tags = gitTry(["tag", "--merged", ref, "--sort=-v:refname", "--list", "v[0-9]*"]) ?? "";
  return tags.split("\n").find((tag) => /^v\d+\.\d+\.\d+$/.test(tag)) ?? null;
}
/** The stable version: the stable branch's own, else (before `streams init`) the newest stable tag. */
function stableVersionOf(config) {
  const fromBranch = readVersion(`origin/${config.stable}`) ?? readVersion(config.stable);
  if (fromBranch) return fromBranch;
  const tag = newestStableTag("HEAD");
  return tag ? tag.slice(1) : null;
}
/** Commits on `head` whose change is not on `base` (by patch id), minus merges and cuts. */
function unpropagated(base, head) {
  const lines = gitTry(["cherry", base, head]) ?? "";
  return lines
    .split("\n")
    .filter((line) => line.startsWith("+ "))
    .map((line) => line.slice(2))
    .map((sha) => ({ sha, subject: gitOut(["log", "-1", "--format=%s", sha]) }))
    .filter((commit) => !isReleaseCutSubject(commit.subject));
}
function flag(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return false;
  args.splice(index, 1);
  return true;
}
function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value) fail(`${name} needs a value`);
  args.splice(index, 2);
  return value;
}
function cut(version, { skipCheck }) {
  if (!skipCheck) npm(["run", "release:check"]);
  execFileSync(
    process.execPath,
    [path.join(rootDir, "scripts/release/set-release-version.mjs"), "--version", version],
    { cwd: rootDir, stdio: "inherit" },
  );
  npm(["run", "release:push"]);
}

/** The fork's pre-merge version and the upstream ref, kept in .git across `--continue`. */
function syncStateFile() {
  return path.resolve(rootDir, gitOut(["rev-parse", "--git-path", "frogg-sync-upstream"]));
}

/** Point every version-owned file at `version` after a merge rewrote them. */
function restamp(version) {
  const file = path.join(rootDir, "package.json");
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.version = version;
  writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
  npm(["run", "version:sync-internal"]);
  npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
  try {
    npm(["run", "nix:hash"]);
  } catch {
    process.stderr.write(
      "warning: could not refresh deploy/nix/npm-deps.hash (needs Nix or Docker); the next release cut will.\n",
    );
  }
}

const commands = {
  help() {
    process.stdout.write(`Release streams (frogg.json "streams"):

  status                      where each stream is and what has not propagated yet
  beta [--major] [--print]    cut the next beta from the development branch
  promote [--print]           ship the development branch's beta line as stable (on the stable branch)
  backport <commit...>        cherry-pick fixes from development onto stable (then release:patch)
  sync-upstream [--ref <ref>] [--continue]
                              merge upstream into a fork's development branch
  contribute <commit...> [--branch <name>] [--open-pr]
                              put fork commits on a branch off upstream and offer them back
  init [--push]               create the stable branch from the newest stable tag
  assert-tag <tag>            CI: fail unless the tag is on its stream's branch
  channel-for-ref <branch>    CI: which brand channel a branch builds (stable or beta)

Add --skip-check to beta/promote to skip release:check (CI has already run it).
`);
  },

  status() {
    const config = readStreamsConfig(rootDir);
    fetchOrigin(config.development, config.stable);
    const dev = refExists(`origin/${config.development}`)
      ? `origin/${config.development}`
      : config.development;
    const stable = refExists(`origin/${config.stable}`) ? `origin/${config.stable}` : null;
    const line = (label, ref) =>
      `  ${label.padEnd(12)} ${ref.padEnd(28)} ${readVersion(ref) ?? "?"}`;
    const out = ["Streams", line("development", dev)];
    if (stable) out.push(line("stable", stable));
    else out.push(`  stable       (no ${config.stable} branch yet; run \`npm run streams -- init\`)`);
    if (config.upstream) {
      gitTry(["fetch", "--quiet", "--tags", config.upstream.remote]);
      const follow = upstreamFollowRef(config);
      if (refExists(follow)) out.push(line("upstream", follow));
      else out.push(`  upstream     ${follow} not found; add the remote and fetch`);
    }
    out.push("");
    if (stable) {
      const pending = unpropagated(stable, dev);
      out.push(`${pending.length} change(s) on ${config.development} not yet in stable`);
      for (const c of pending.slice(0, 15)) out.push(`  ${c.sha.slice(0, 9)} ${c.subject}`);
      const stranded = unpropagated(dev, stable);
      if (stranded.length) {
        out.push(`${stranded.length} stable-only change(s) missing from ${config.development}:`);
        for (const c of stranded) out.push(`  ${c.sha.slice(0, 9)} ${c.subject}`);
      }
    }
    if (config.upstream && refExists(upstreamFollowRef(config))) {
      const follow = upstreamFollowRef(config);
      const incoming = Number(gitOut(["rev-list", "--count", `${dev}..${follow}`]));
      out.push(`${incoming} upstream commit(s) not merged into ${config.development}`);
      const upstreamDev = `${config.upstream.remote}/${config.upstream.development}`;
      if (refExists(upstreamDev)) {
        const outgoing = unpropagated(upstreamDev, dev).filter(
          (c) => gitOut(["rev-list", "--parents", "-n", "1", c.sha]).split(" ").length === 2,
        );
        out.push(`${outgoing.length} fork change(s) not upstream (candidates for release:contribute)`);
        for (const c of outgoing.slice(0, 15)) out.push(`  ${c.sha.slice(0, 9)} ${c.subject}`);
      }
    }
    process.stdout.write(out.join("\n") + "\n");
  },

  beta(args) {
    const config = readStreamsConfig(rootDir);
    const print = flag(args, "--print");
    const skipCheck = flag(args, "--skip-check");
    const major = flag(args, "--major");
    if (!print) {
      assertOnBranch(config.development, "release:beta");
      assertClean();
    }
    fetchOrigin(config.development, config.stable);
    let upstreamVersion = null;
    const follow = upstreamFollowRef(config);
    if (follow && refExists(follow)) {
      const base = gitTry(["merge-base", "HEAD", follow]);
      upstreamVersion = base ? readVersion(base) : null;
    }
    const version = nextBetaVersion({
      developmentVersion: readVersion("HEAD"),
      stableVersion: stableVersionOf(config),
      upstreamVersion,
      major,
    });
    if (print) return void process.stdout.write(`${version}\n`);
    cut(version, { skipCheck });
  },

  promote(args) {
    const config = readStreamsConfig(rootDir);
    const print = flag(args, "--print");
    const skipCheck = flag(args, "--skip-check");
    const allowDrop = flag(args, "--allow-drop");
    fetchOrigin(config.development, config.stable);
    const devRef = `origin/${config.development}`;
    if (!refExists(devRef)) fail(`${devRef} not found.`);
    const version = promotionVersion({
      developmentVersion: readVersion(devRef),
      stableVersion: readVersion("HEAD"),
    });
    if (print) return void process.stdout.write(`${version}\n`);
    assertOnBranch(config.stable, "release:promote");
    assertClean();
    // Promotion copies the development tree up. A fix made only on stable would be dropped by
    // that copy, so it must reach development first.
    const stranded = unpropagated(devRef, "HEAD").filter(
      (c) => gitOut(["rev-list", "--parents", "-n", "1", c.sha]).split(" ").length === 2,
    );
    if (stranded.length && !allowDrop) {
      fail(
        `These stable commits are not on ${config.development}; promoting would drop them:\n` +
          stranded.map((c) => `  ${c.sha.slice(0, 9)} ${c.subject}`).join("\n") +
          `\nCherry-pick them onto ${config.development} (or pass --allow-drop if they are obsolete).`,
      );
    }
    git(["merge", "--no-ff", "--no-commit", "-s", "ours", devRef]);
    git(["read-tree", "-u", "--reset", devRef]);
    git([
      "commit",
      "--no-verify",
      "-m",
      `chore(release): promote ${config.development} ${readVersion(devRef)} to ${config.stable}`,
    ]);
    cut(version, { skipCheck });
  },

  backport(args) {
    const config = readStreamsConfig(rootDir);
    if (args.length === 0) fail("Name the commits to backport: release:backport -- <commit...>");
    assertOnBranch(config.stable, "release:backport");
    assertClean();
    fetchOrigin(config.development);
    for (const commit of args) {
      const subject = gitOut(["log", "-1", "--format=%s", commit]);
      if (isReleaseCutSubject(subject)) fail(`${subject}: release cuts are not backported.`);
      const files = gitOut(["show", "--format=", "--name-only", commit]).split("\n").filter(Boolean);
      if (files.length && files.every(isVersionOwnedFile))
        fail(`${subject}: only touches version files; nothing to backport.`);
      process.stdout.write(`backporting: ${subject}\n`);
      const result = spawnSync("git", ["cherry-pick", "-x", commit], {
        cwd: rootDir,
        stdio: "inherit",
      });
      if (result.status !== 0) {
        fail(
          `"${subject}" does not apply cleanly. Resolve, \`git cherry-pick --continue\`, then re-run release:backport with the remaining commits.`,
        );
      }
    }
    // A patch must stay below the beta line; set-release-version enforces it when you cut.
    const devVersion = readVersion(`origin/${config.development}`);
    process.stdout.write(
      `\nBackported ${args.length} commit(s). Push ${config.stable} for CI, then \`npm run release:patch\` to ship them` +
        (devVersion ? ` (beta line: ${devVersion}).` : ".") +
        "\n",
    );
  },

  "sync-upstream"(args) {
    const config = readStreamsConfig(rootDir);
    if (!config.upstream) fail('frogg.json has no "streams.upstream"; this is not a fork.');
    const resume = flag(args, "--continue");
    const explicitRef = option(args, "--ref");
    assertOnBranch(config.development, "release:sync-upstream");
    const mergeHead = gitTry(["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
    if (!resume) {
      assertClean();
      const { remote, stable, follow } = config.upstream;
      git(["fetch", "--tags", remote]);
      let ref = explicitRef ?? upstreamFollowRef(config);
      // Following upstream stable means following its releases, not whatever is on the branch.
      if (!explicitRef && follow === "stable") {
        ref = newestStableTag(`${remote}/${stable}`) ?? ref;
      }
      if (!refExists(ref)) fail(`${ref} not found. Is the "${remote}" remote set up?`);
      if (gitTry(["merge-base", "--is-ancestor", ref, "HEAD"]) !== null) {
        return void process.stdout.write(`Already up to date with ${ref}.\n`);
      }
      const version = readVersion("HEAD");
      writeFileSync(syncStateFile(), `${version}\n${ref}\n`);
      const merged = spawnSync(
        "git",
        ["merge", "--no-ff", "--no-commit", "-m", `Merge upstream ${ref}`, ref],
        { cwd: rootDir, stdio: "inherit" },
      );
      if (merged.status !== 0) {
        const conflicted = gitOut(["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
        const owned = conflicted.filter(isVersionOwnedFile);
        // Version lines always conflict; take upstream's file (it carries upstream's dependency
        // changes) and restamp the fork's version below.
        for (const file of owned) {
          git(["checkout", "--theirs", "--", file]);
          git(["add", file]);
        }
        const others = conflicted.filter((file) => !isVersionOwnedFile(file));
        if (others.length) {
          fail(
            `Resolve these, \`git add\` them, then run \`npm run release:sync-upstream -- --continue\`:\n` +
              others.map((file) => `  ${file}`).join("\n"),
          );
        }
      }
    } else if (!mergeHead) {
      fail("No upstream merge in progress.");
    }
    if (gitOut(["diff", "--name-only", "--diff-filter=U"])) fail("Some files still conflict.");
    const [version, ref] = readFileSync(syncStateFile(), "utf8")
      .trim()
      .split("\n");
    restamp(version);
    git(["add", "-u"]);
    git(["add", "--", "package-lock.json"]);
    git(["commit", "--no-verify", "--no-edit", "-m", `Merge upstream ${ref}`]);
    rmSync(syncStateFile(), { force: true });
    process.stdout.write(
      `\nMerged ${ref}. Push ${config.development}; its CI builds the beta you test before promoting.\n` +
        `Cut that beta with \`npm run release:beta\`.\n`,
    );
  },

  contribute(args) {
    const config = readStreamsConfig(rootDir);
    if (!config.upstream) fail('frogg.json has no "streams.upstream"; this is not a fork.');
    const openPr = flag(args, "--open-pr");
    const branchOption = option(args, "--branch");
    if (args.length === 0) fail("Name the commits to offer upstream: release:contribute -- <commit...>");
    const { remote, development, repository } = config.upstream;
    git(["fetch", remote, development]);
    const subjects = args.map((commit) => gitOut(["log", "-1", "--format=%s", commit]));
    for (const commit of args) {
      const files = gitOut(["show", "--format=", "--name-only", commit]).split("\n").filter(Boolean);
      const branded = files.filter((file) => file.startsWith("brands/") && !file.startsWith("brands/example/"));
      if (branded.length) {
        fail(`${commit} touches your brand (${branded.join(", ")}); upstream only takes product changes.`);
      }
    }
    const slug = subjects[0]
      .replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48);
    const branch = branchOption ?? `contrib/${slug || "change"}`;
    // A throwaway worktree, so the current checkout and its build outputs are left alone.
    const scratch = mkdtempSync(path.join(os.tmpdir(), "frogg-contribute-"));
    try {
      git(["worktree", "add", "--quiet", "-b", branch, scratch, `${remote}/${development}`]);
      for (const commit of args) {
        const picked = spawnSync("git", ["cherry-pick", "-x", commit], { cwd: scratch, stdio: "inherit" });
        if (picked.status !== 0) {
          spawnSync("git", ["cherry-pick", "--abort"], { cwd: scratch });
          fail(
            `${commit} does not apply to ${remote}/${development}. Rebase it on upstream first; branch ${branch} was left for you.`,
          );
        }
      }
      git(["push", "-u", "origin", branch], { cwd: scratch });
    } finally {
      gitTry(["worktree", "remove", "--force", scratch]);
      rmSync(scratch, { recursive: true, force: true });
    }
    const origin = gitOut(["remote", "get-url", "origin"]);
    const owner = /[:/]([^/:]+)\/[^/]+?(?:\.git)?$/.exec(origin)?.[1] ?? "<your-org>";
    const upstreamRepo =
      repository ??
      /github\.com[:/](.+?)(?:\.git)?$/.exec(gitOut(["remote", "get-url", remote]))?.[1] ??
      "<upstream-owner>/<repo>";
    const prArgs = [
      "pr",
      "create",
      "--repo",
      upstreamRepo,
      "--base",
      development,
      "--head",
      `${owner}:${branch}`,
      "--fill",
    ];
    if (openPr) {
      execFileSync("gh", prArgs, { cwd: rootDir, stdio: "inherit" });
    } else {
      process.stdout.write(
        `\nPushed ${branch} (${args.length} commit(s) on ${remote}/${development}).\nOpen the pull request upstream with:\n  gh ${prArgs.join(" ")}\n`,
      );
    }
  },

  init(args) {
    const config = readStreamsConfig(rootDir);
    const push = flag(args, "--push");
    fetchOrigin(config.development, config.stable);
    if (refExists(`origin/${config.stable}`) || refExists(config.stable)) {
      return void process.stdout.write(`${config.stable} already exists.\n`);
    }
    const tag = newestStableTag(`origin/${config.development}`) ?? newestStableTag("HEAD");
    if (!tag) fail(`No stable vX.Y.Z tag to start ${config.stable} from.`);
    git(["branch", config.stable, tag]);
    process.stdout.write(`Created ${config.stable} at ${tag}.\n`);
    if (push) git(["push", "-u", "origin", config.stable]);
    else process.stdout.write(`Publish it with: git push -u origin ${config.stable}\n`);
  },

  "assert-tag"(args) {
    const tag = args[0] ?? fail("usage: assert-tag <tag>");
    const config = readStreamsConfig(rootDir);
    const branch = branchForVersion(config, tag);
    gitTry(["fetch", "--quiet", "origin", `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    if (!refExists(`origin/${branch}`)) {
      fail(`::error::${tag} ships from ${branch}, and origin/${branch} does not exist.`);
    }
    if (gitTry(["merge-base", "--is-ancestor", `${tag}^{commit}`, `origin/${branch}`]) === null) {
      fail(
        `::error::${tag} is not on origin/${branch}. Betas are cut from ${config.development}, stable releases from ${config.stable}.`,
      );
    }
    process.stdout.write(`${tag} is on origin/${branch}.\n`);
  },

  "channel-for-ref"(args) {
    const config = readStreamsConfig(rootDir);
    process.stdout.write(`${channelForBranch(config, (args[0] ?? "").replace(/^refs\/heads\//, ""))}\n`);
  },
};

const [name = "help", ...rest] = process.argv.slice(2);
const command = commands[name];
if (!command) fail(`Unknown command "${name}". Run \`npm run streams -- help\`.`);
command(rest);
