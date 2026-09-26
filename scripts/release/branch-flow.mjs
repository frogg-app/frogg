// Git side of the main/beta release flow. The rules live in
// branch-flow-core.mjs and release-branches.mjs; this file only runs git/npm.
//
//   sync-beta [--continue]      on beta: merge origin/main, keep beta's version, push beta
//   promote-merge [--continue]  on main: merge origin/beta, keep main's version (no push)
//   promote-cut                 on main: restamp to beta's base version and commit the cut
//   fast-forward-beta           push main to beta, fast-forward only
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isRegeneratedPath,
  isVersionOwnedPath,
  promotionVersion,
  resolveSyncedVersion,
} from "./branch-flow-core.mjs";
import { BETA_BRANCH, STABLE_BRANCH } from "./release-branches.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const rootPackagePath = path.join(rootDir, "package.json");

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function git(...args) {
  execFileSync("git", args, { cwd: rootDir, stdio: "inherit" });
}

function gitOut(...args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

function gitLines(...args) {
  return gitOut(...args)
    .split("\n")
    .filter(Boolean);
}

function assertClean() {
  if (gitOut("status", "--porcelain")) {
    fail("Working tree is not clean. Commit or stash first.");
  }
}

function assertOnBranch(name) {
  const branch = gitOut("branch", "--show-current");
  if (branch !== name) {
    fail(`This step runs on ${name}; you are on ${branch || "(detached)"}.`);
  }
}

function readVersion(ref) {
  try {
    return JSON.parse(gitOut("show", `${ref}:package.json`)).version;
  } catch {
    return fail(`Cannot read package.json at ${ref}. Does it exist? (git fetch origin)`);
  }
}

function mergeInProgress() {
  return (
    spawnSync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: rootDir }).status === 0
  );
}

function hasConflictMarkers(file) {
  const full = path.join(rootDir, file);
  return existsSync(full) && /^<<<<<<< /m.test(readFileSync(full, "utf8"));
}

// Root package.json is the source of truth; `npm run version` syncs the
// workspaces, Cargo manifest and lockfiles, refreshes the Nix hash and stages.
function restamp(version) {
  const pkg = JSON.parse(readFileSync(rootPackagePath, "utf8"));
  pkg.version = version;
  writeFileSync(rootPackagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  execFileSync("npm", ["run", "version"], { cwd: rootDir, stdio: "inherit" });
}

// Cargo.lock is not rewritten by npm; let cargo reconcile it with the merged
// Cargo.toml without upgrading anything else.
function reconcileCargoLock(lockFile) {
  const manifest = path.join(rootDir, path.dirname(lockFile), "Cargo.toml");
  const result = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--manifest-path", manifest],
    {
      cwd: rootDir,
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  if (result.error || result.status !== 0) {
    process.stderr.write(
      `warning: could not run cargo to reconcile ${lockFile}; check it builds before pushing.\n`,
    );
  }
}

// Merges origin/<source> into the current branch, keeping this branch's
// version. Returns false when there was nothing to merge.
function mergeKeepingVersion({ target, source, resume, message }) {
  assertOnBranch(target);
  // npm appends `--continue` to the last command of a chain, so promote
  // resumes through the script directly and then re-runs the whole chain.
  const resumeHint =
    target === BETA_BRANCH
      ? "run `npm run release:sync-beta -- --continue`"
      : "run `node scripts/release/branch-flow.mjs promote-merge --continue`, then `npm run release:promote` again";

  if (resume) {
    if (!mergeInProgress()) fail("No merge in progress to continue.");
  } else {
    assertClean();
    git("fetch", "origin", STABLE_BRANCH, BETA_BRANCH);
    const merge = spawnSync("git", ["merge", "--no-ff", "--no-commit", `origin/${source}`], {
      cwd: rootDir,
      stdio: "inherit",
    });
    if (merge.status === 0 && !mergeInProgress()) {
      console.log(`${target} already contains origin/${source}.`);
      return false;
    }
  }

  // During a merge HEAD is still the pre-merge commit.
  const version = resolveSyncedVersion({
    targetBranch: target,
    preMergeVersion: readVersion("HEAD"),
  });

  const conflicted = gitLines("diff", "--name-only", "--diff-filter=U");
  const others = conflicted.filter((file) => !isVersionOwnedPath(file));
  for (const file of conflicted.filter(isVersionOwnedPath)) {
    console.log(`${file}: version-owned, will be restamped to ${version}`);
  }
  if (others.length > 0) {
    fail(
      `Conflicts outside the version files:\n${others.map((f) => `  ${f}`).join("\n")}\n` +
        `Resolve these, \`git add\` them, then ${resumeHint}.`,
    );
  }

  for (const file of conflicted.filter(isRegeneratedPath)) {
    git("checkout", "--theirs", "--", file);
    if (file.endsWith("Cargo.lock")) reconcileCargoLock(file);
    git("add", "--", file);
  }

  const manifests = conflicted.filter(
    (file) => !isRegeneratedPath(file) && hasConflictMarkers(file),
  );
  if (manifests.length > 0) {
    fail(
      `These manifests still have conflict markers:\n${manifests.map((f) => `  ${f}`).join("\n")}\n` +
        "Resolve them (either side's version line is fine, the restamp overwrites it), " +
        `\`git add\` them, then ${resumeHint}.`,
    );
  }

  restamp(version);
  git("commit", ...(message ? ["-m", message] : ["--no-edit"]));
  return true;
}

const [command, ...rest] = process.argv.slice(2);
const resume = rest.includes("--continue");

switch (command) {
  case "sync-beta": {
    if (mergeKeepingVersion({ target: BETA_BRANCH, source: STABLE_BRANCH, resume })) {
      git("push", "origin", BETA_BRANCH);
    }
    break;
  }
  case "promote-merge": {
    mergeKeepingVersion({
      target: STABLE_BRANCH,
      source: BETA_BRANCH,
      resume,
      message: "chore(release): merge beta for promotion",
    });
    break;
  }
  case "promote-cut": {
    assertOnBranch(STABLE_BRANCH);
    assertClean();
    const version = promotionVersion({
      betaVersion: readVersion(`origin/${BETA_BRANCH}`),
      mainVersion: readVersion("HEAD"),
    });
    restamp(version);
    // Same message `npm version` writes, so the tag and changelog flow is unchanged.
    git("commit", "-m", `chore(release): cut ${version}`);
    break;
  }
  case "fast-forward-beta": {
    assertOnBranch(STABLE_BRANCH);
    const push = spawnSync("git", ["push", "origin", `${STABLE_BRANCH}:${BETA_BRANCH}`], {
      cwd: rootDir,
      stdio: "inherit",
    });
    if (push.status !== 0) {
      fail(
        `origin/${BETA_BRANCH} has commits that are not on ${STABLE_BRANCH}; not forcing. ` +
          `Merge them into ${STABLE_BRANCH} (or drop them) and re-run fast-forward-beta.`,
      );
    }
    break;
  }
  default:
    fail(
      "Usage: node scripts/release/branch-flow.mjs " +
        "<sync-beta|promote-merge|promote-cut|fast-forward-beta> [--continue]",
    );
}
