import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { mergeUpstreamStreams, parseArgs, planRemote, repositoryFromUrl } from "./fork-setup.mjs";

const script = fileURLToPath(new URL("./fork-setup.mjs", import.meta.url));

function git(directory, ...args) {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepos() {
  const root = mkdtempSync(path.join(tmpdir(), "fork-setup-"));
  const upstream = path.join(root, "upstream");
  const fork = path.join(root, "fork");
  for (const directory of [upstream, fork]) {
    execFileSync("git", ["init", "-q", "-b", "main", directory]);
    git(directory, "config", "user.email", "test@example.com");
    git(directory, "config", "user.name", "Test");
  }
  writeFileSync(path.join(upstream, "README.md"), "upstream\n");
  git(upstream, "add", "-A");
  git(upstream, "commit", "-qm", "base");
  git(upstream, "tag", "v1.0.0");
  git(upstream, "branch", "stable");
  writeFileSync(
    path.join(fork, "frogg.json"),
    `${JSON.stringify({ streams: { development: "main", stable: "stable" } }, null, 2)}\n`,
  );
  git(fork, "add", "-A");
  git(fork, "commit", "-qm", "fork");
  return { root, upstream, fork };
}

function setup(cwd, ...args) {
  return execFileSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
}

test("arguments", () => {
  const options = parseArgs(["--suffix", "acme", "--follow=development", "--dry-run"]);
  assert.equal(options.suffix, "acme");
  assert.equal(options.follow, "development");
  assert.equal(options.dryRun, true);
  assert.equal(options.upstreamUrl, undefined);
  assert.equal(
    parseArgs(["--upstream-url", "git@github.com:a/b.git"]).upstreamUrl,
    "git@github.com:a/b.git",
  );
  assert.throws(() => parseArgs(["--suffix"]), /needs a value/u);
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/u);
});

test("repository names come from https, ssh and scp URLs", () => {
  assert.equal(repositoryFromUrl("https://github.com/frogg-app/frogg.git"), "frogg-app/frogg");
  assert.equal(repositoryFromUrl("git@github.com:frogg-app/frogg.git"), "frogg-app/frogg");
  assert.equal(repositoryFromUrl("ssh://git@github.com/acme/studio"), "acme/studio");
  assert.equal(repositoryFromUrl("/tmp/upstream"), null);
  assert.equal(repositoryFromUrl("file:///srv/git/acme/frogg.git"), "acme/frogg");
});

test("remote plan", () => {
  assert.equal(planRemote(null, "https://x/a/b.git"), "add");
  assert.equal(planRemote("https://x/a/b", "https://x/a/b.git"), "keep");
  assert.equal(planRemote("https://x/a/c.git", "https://x/a/b.git"), "conflict");
});

test("streams merge keeps what the file says and validates the result", () => {
  const base = { scripts: {}, streams: { development: "main", stable: "stable" } };
  const first = mergeUpstreamStreams(base, {
    upstreamUrl: "https://github.com/frogg-app/frogg.git",
    suffix: "acme",
  });
  assert.equal(first.changed, true);
  assert.deepEqual(first.next.streams.upstream, {
    remote: "upstream",
    repository: "frogg-app/frogg",
    follow: "stable",
    suffix: "acme",
  });
  assert.deepEqual(Object.keys(first.next), ["scripts", "streams"]);
  const again = mergeUpstreamStreams(first.next, {});
  assert.equal(again.changed, false);
  const follow = mergeUpstreamStreams(first.next, { follow: "development" });
  assert.equal(follow.next.streams.upstream.follow, "development");
  assert.equal(follow.next.streams.upstream.suffix, "acme");
  assert.throws(() => mergeUpstreamStreams(base, { suffix: "beta" }), /suffix/u);
  assert.throws(() => mergeUpstreamStreams(base, { follow: "nightly" }), /follow/u);
});

test("dry run changes nothing; a real run is idempotent", () => {
  const { root, upstream, fork } = makeRepos();
  try {
    const before = readFileSync(path.join(fork, "frogg.json"), "utf8");
    const dry = setup(fork, "--upstream-url", upstream, "--suffix", "acme", "--dry-run");
    assert.match(dry, /would: git remote add upstream/u);
    assert.equal(readFileSync(path.join(fork, "frogg.json"), "utf8"), before);
    assert.throws(() => git(fork, "remote", "get-url", "upstream"));

    const first = setup(fork, "--upstream-url", upstream, "--suffix", "acme");
    assert.match(first, /git remote add upstream/u);
    assert.equal(git(fork, "remote", "get-url", "upstream"), upstream);
    assert.ok(git(fork, "rev-parse", "refs/remotes/upstream/tags/v1.0.0"));
    const written = JSON.parse(readFileSync(path.join(fork, "frogg.json"), "utf8"));
    assert.equal(written.streams.upstream.suffix, "acme");
    assert.equal(written.streams.upstream.follow, "stable");

    const second = setup(fork, "--suffix", "acme");
    assert.match(second, /remote upstream already points at/u);
    assert.match(second, /streams.upstream already set/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a remote that points elsewhere stops the run", () => {
  const { root, fork } = makeRepos();
  try {
    git(fork, "remote", "add", "upstream", "https://example.com/other/repo.git");
    assert.throws(
      () =>
        execFileSync(process.execPath, [script, "--upstream-url", "https://example.com/a/b.git"], {
          cwd: fork,
          stdio: ["ignore", "pipe", "pipe"],
        }),
      /points at/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--init-stable creates the stable branch from the newest stable tag", () => {
  const { root, upstream, fork } = makeRepos();
  try {
    const release = fileURLToPath(new URL("../release/", import.meta.url));
    mkdirSync(path.join(fork, "scripts/release"), { recursive: true });
    for (const file of readdirSync(release).filter((name) => /^[a-z-]+\.mjs$/u.test(name))) {
      copyFileSync(path.join(release, file), path.join(fork, "scripts/release", file));
    }
    writeFileSync(path.join(fork, "package.json"), '{ "version": "1.0.0" }\n');
    git(fork, "add", "-A");
    git(fork, "commit", "-qm", "release scripts");
    git(fork, "tag", "v1.0.0");
    const output = setup(fork, "--upstream-url", upstream, "--suffix", "acme", "--init-stable");
    assert.match(output, /Created stable at v1\.0\.0/u);
    assert.equal(git(fork, "rev-parse", "stable"), git(fork, "rev-parse", "v1.0.0^{commit}"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
