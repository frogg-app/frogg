// End to end: the stream commands against scratch repositories (a bare "origin", an upstream,
// and a fork), with the real release scripts copied in and a minimal package.json whose
// release hooks are no-ops.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = [
  "streams.mjs",
  "streams-config.mjs",
  "streams-core.mjs",
  "release-channel.mjs",
  "release-version-utils.mjs",
  "set-release-version.mjs",
  "push-current-release-tag.mjs",
];

function sh(cwd, cmd, args) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  }).trim();
}
const git = (cwd, ...args) => sh(cwd, "git", args);
const streams = (cwd, ...args) =>
  sh(cwd, process.execPath, [path.join(cwd, "scripts/release/streams.mjs"), ...args]);
function streamsFails(cwd, ...args) {
  const result = spawnSync(
    process.execPath,
    [path.join(cwd, "scripts/release/streams.mjs"), ...args],
    {
      cwd,
      encoding: "utf8",
    },
  );
  assert.notEqual(result.status, 0, `expected streams ${args.join(" ")} to fail`);
  return result.stderr + result.stdout;
}
const version = (cwd) => JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")).version;
function commit(cwd, file, content, message) {
  writeFileSync(path.join(cwd, file), content);
  git(cwd, "add", file);
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}

function scaffold(root, name, frogg = {}) {
  const origin = path.join(root, `${name}.git`);
  const work = path.join(root, name);
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", "main");
  mkdirSync(path.join(work, "scripts/release"), { recursive: true });
  for (const file of SCRIPTS) {
    copyFileSync(path.join(here, file), path.join(work, "scripts/release", file));
  }
  writeFileSync(
    path.join(work, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.5.0",
        private: true,
        scripts: {
          "release:check": "node -e 0",
          "release:push": "node scripts/release/push-current-release-tag.mjs",
          "version:sync-internal": "node -e 0",
          "nix:hash": "node -e 0",
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFileSync(path.join(work, "frogg.json"), JSON.stringify({ streams: frogg }, null, 2));
  writeFileSync(path.join(work, "app.txt"), "v1\n");
  git(work, "add", "-A");
  git(work, "commit", "-qm", "chore(release): cut 1.5.0");
  git(work, "tag", "-a", "v1.5.0", "-m", "v1.5.0");
  git(work, "push", "-q", "origin", "main", "--tags");
  return { origin, work };
}

test("betas on main, backports and promotion on stable", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "streams-flow-"));
  try {
    const { work } = scaffold(root, "product");
    assert.match(streams(work, "init", "--push"), /Created stable at v1\.5\.0/);

    commit(work, "feature.txt", "feature\n", "feat: a feature");
    streams(work, "beta", "--skip-check");
    assert.equal(version(work), "1.6.0-beta.1");
    assert.match(streams(work, "assert-tag", "v1.6.0-beta.1"), /on origin\/main/);
    git(work, "tag", "v1.5.9");
    assert.match(streamsFails(work, "assert-tag", "v1.5.9"), /not on origin\/stable/);
    git(work, "tag", "-d", "v1.5.9");

    const fix = commit(work, "app.txt", "v1 fixed\n", "fix: the app");
    git(work, "push", "-q", "origin", "main");

    git(work, "switch", "-q", "stable");
    assert.match(streamsFails(work, "beta", "--skip-check"), /runs on main/);
    streams(work, "backport", fix);
    assert.equal(readFileSync(path.join(work, "app.txt"), "utf8"), "v1 fixed\n");
    assert.match(git(work, "log", "-1", "--format=%B"), /cherry picked from commit/);
    sh(work, process.execPath, ["scripts/release/set-release-version.mjs", "--mode", "patch"]);
    assert.equal(version(work), "1.5.1");
    // Stable minors only arrive by promotion.
    assert.match(
      spawnSync(process.execPath, ["scripts/release/set-release-version.mjs", "--mode", "minor"], {
        cwd: work,
        encoding: "utf8",
      }).stderr,
      /ships by promoting a beta line/,
    );
    git(work, "push", "-q", "origin", "stable");

    // The backported fix is recognised as already on stable; only the feature is pending.
    const status = streams(work, "status");
    assert.match(status, /1 change\(s\) on main not yet in stable/);
    assert.match(status, /feat: a feature/);

    // A fix made only on stable blocks promotion until it reaches main.
    const strandedFix = commit(work, "hotfix.txt", "x\n", "fix: stable only");
    assert.match(streamsFails(work, "promote", "--skip-check"), /fix: stable only/);
    git(work, "reset", "-q", "--hard", "HEAD~1");
    assert.ok(strandedFix);

    streams(work, "promote", "--skip-check");
    assert.equal(version(work), "1.6.0");
    // Promotion copies the development tree up exactly.
    assert.equal(
      git(work, "diff", "--stat", "origin/main", "HEAD", "--", ".", ":!package.json"),
      "",
    );
    assert.match(streams(work, "assert-tag", "v1.6.0"), /on origin\/stable/);

    git(work, "switch", "-q", "main");
    git(work, "pull", "-q", "--ff-only");
    assert.equal(streams(work, "beta", "--print"), "1.7.0-beta.1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fork syncs upstream releases and contributes changes back", { timeout: 120_000 }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "streams-fork-"));
  try {
    const upstream = scaffold(root, "upstream");
    streams(upstream.work, "init", "--push");

    const forkOrigin = path.join(root, "fork.git");
    const fork = path.join(root, "fork");
    git(root, "clone", "-q", "--bare", upstream.origin, forkOrigin);
    git(root, "clone", "-q", forkOrigin, fork);
    git(fork, "remote", "add", "upstream", upstream.origin);
    writeFileSync(
      path.join(fork, "frogg.json"),
      JSON.stringify({ streams: { upstream: { follow: "stable" } } }, null, 2),
    );
    git(fork, "commit", "-qam", "chore: declare the upstream stream");
    const forkFix = commit(fork, "shared.txt", "fork fix\n", "fix: something upstream wants");
    git(fork, "push", "-q", "origin", "main");

    // Upstream ships 1.6.0 through its own streams.
    commit(upstream.work, "upstream.txt", "new\n", "feat: upstream feature");
    streams(upstream.work, "beta", "--skip-check");
    git(upstream.work, "switch", "-q", "stable");
    streams(upstream.work, "promote", "--skip-check");

    // The fork follows upstream stable: it merges the v1.6.0 release, keeps its own version,
    // and its next beta starts the upstream line.
    streams(fork, "sync-upstream");
    assert.equal(readFileSync(path.join(fork, "upstream.txt"), "utf8"), "new\n");
    assert.equal(version(fork), "1.5.0");
    assert.match(git(fork, "log", "-1", "--format=%s"), /Merge upstream v1\.6\.0/);
    assert.match(streams(fork, "sync-upstream"), /Already up to date/);
    assert.equal(streams(fork, "beta", "--print"), "1.6.0-beta.1");

    const status = streams(fork, "status");
    assert.match(status, /fork change\(s\) not upstream/);
    assert.match(status, /fix: something upstream wants/);

    const out = streams(fork, "contribute", forkFix, "--branch", "contrib/shared-fix");
    assert.match(out, /gh pr create --repo .* --base main --head .*:contrib\/shared-fix/);
    assert.equal(git(fork, "branch", "--show-current"), "main");
    const pushed = git(forkOrigin, "log", "--format=%s", "contrib/shared-fix");
    assert.match(pushed, /fix: something upstream wants/);
    assert.doesNotMatch(pushed, /declare the upstream stream/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "a fork with a build suffix ships upstream's versions with its own counter",
  { timeout: 120_000 },
  () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "streams-suffix-"));
    try {
      const upstream = scaffold(root, "upstream");
      streams(upstream.work, "init", "--push");

      const forkOrigin = path.join(root, "fork.git");
      const fork = path.join(root, "fork");
      git(root, "clone", "-q", "--bare", upstream.origin, forkOrigin);
      git(root, "clone", "-q", forkOrigin, fork);
      git(fork, "remote", "add", "upstream", upstream.origin);
      writeFileSync(
        path.join(fork, "frogg.json"),
        JSON.stringify({ streams: { upstream: { follow: "stable", suffix: "acme" } } }, null, 2),
      );
      git(fork, "commit", "-qam", "chore: declare the upstream stream");
      git(fork, "push", "-q", "origin", "main");
      streams(fork, "init", "--push");

      // Upstream ships 1.6.0.
      commit(upstream.work, "upstream.txt", "new\n", "feat: upstream feature");
      streams(upstream.work, "beta", "--skip-check");
      git(upstream.work, "switch", "-q", "stable");
      streams(upstream.work, "promote", "--skip-check");

      // The fork merges it and cuts a release candidate of upstream 1.6.0 for its beta testers.
      streams(fork, "sync-upstream");
      streams(fork, "beta", "--skip-check");
      assert.equal(version(fork), "1.6.0-rc.1.acme.1");
      assert.match(streams(fork, "assert-tag", "v1.6.0-rc.1.acme.1"), /on origin\/main/);
      const fix = commit(fork, "fix.txt", "fixed\n", "fix: fork-only fix");
      streams(fork, "beta", "--skip-check");
      assert.equal(version(fork), "1.6.0-rc.1.acme.2");

      // Promoted to its stable users as 1.6.0-acme.1; a backported fix ships as 1.6.0-acme.2.
      git(fork, "switch", "-q", "-c", "stable", "--track", "origin/stable");
      streams(fork, "promote", "--skip-check");
      assert.equal(version(fork), "1.6.0-acme.1");
      assert.match(streams(fork, "assert-tag", "v1.6.0-acme.1"), /on origin\/stable/);
      const late = commit(fork, "late.txt", "late\n", "fix: after the release");
      git(fork, "reset", "-q", "--hard", "HEAD~1");
      assert.ok(late && fix);
      git(fork, "switch", "-q", "main");
      const mainFix = commit(fork, "hot.txt", "hot\n", "fix: hot fix");
      git(fork, "push", "-q", "origin", "main");
      git(fork, "switch", "-q", "stable");
      streams(fork, "backport", mainFix);
      git(fork, "push", "-q", "origin", "stable");
      assert.equal(streams(fork, "patch", "--print"), "1.6.0-acme.2");
      streams(fork, "patch", "--skip-check");
      assert.equal(version(fork), "1.6.0-acme.2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
