import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { ReleaseStreamChange } from "@frogg/protocol/messages";
import { resolveReleaseStreamsConfig } from "./config.js";
import { buildReleaseStreamsGraph, type StreamsGit } from "./graph.js";

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: "pipe" }).trim();
}
function runner(cwd: string): StreamsGit {
  return async (args) => git(cwd, ...args);
}
function commit(cwd: string, file: string, message: string, version?: string): string {
  writeFileSync(path.join(cwd, file), `${message}\n`);
  if (version) writeFileSync(path.join(cwd, "package.json"), JSON.stringify({ version }));
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}
function tag(cwd: string, name: string) {
  git(cwd, "tag", "-a", name, "-m", name);
}

function product(): { root: string; work: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), "streams-graph-"));
  roots.push(root);
  const work = path.join(root, "work");
  git(root, "init", "-q", "--bare", "-b", "main", path.join(root, "origin.git"));
  git(root, "clone", "-q", path.join(root, "origin.git"), work);
  git(work, "checkout", "-q", "-b", "main");
  commit(work, "app.txt", "chore(release): cut 1.5.0", "1.5.0");
  tag(work, "v1.5.0");
  git(work, "branch", "stable");
  return { root, work };
}

const find = (changes: ReleaseStreamChange[], subject: string) => {
  const change = changes.find((c) => c.subject === subject);
  if (!change) throw new Error(`no change "${subject}"`);
  return Object.fromEntries(change.presence.map((p) => [p.stream, p]));
};

describe("release streams graph", () => {
  test("tracks promotion, backports and stable-only fixes", async () => {
    const { work } = product();
    commit(work, "a.txt", "feat(ui): first feature");
    commit(work, "p.txt", "chore(release): cut 1.6.0-beta.1", "1.6.0-beta.1");
    tag(work, "v1.6.0-beta.1");
    const fix = commit(work, "fix.txt", "fix(server): crash on start");
    commit(work, "p.txt", "chore(release): cut 1.6.0-beta.2", "1.6.0-beta.2");
    tag(work, "v1.6.0-beta.2");
    commit(work, "b.txt", "feat: second feature");

    git(work, "switch", "-q", "stable");
    git(work, "cherry-pick", "-x", fix);
    commit(work, "p.txt", "chore(release): cut 1.5.1", "1.5.1");
    tag(work, "v1.5.1");
    commit(work, "hot.txt", "fix: stable-only hotfix");
    git(work, "push", "-q", "origin", "main", "stable", "--tags");

    const config = resolveReleaseStreamsConfig({ raw: null, remotes: ["origin"] });
    const graph = await buildReleaseStreamsGraph({ git: runner(work), config });

    const streams = Object.fromEntries(graph.streams.map((s) => [s.id, s]));
    expect(streams.stable!.releases.map((r) => r.version)).toEqual(["1.5.1", "1.5.0"]);
    expect(streams.stable!.ref).toBe("refs/remotes/origin/stable");
    expect(streams.development!.releases.map((r) => r.version)).toEqual([
      "1.6.0-beta.2",
      "1.6.0-beta.1",
    ]);
    expect(streams.development!.version).toBe("1.6.0-beta.2");
    expect(streams.development!.unreleased).toBe(1);

    const first = find(graph.changes, "feat(ui): first feature");
    expect(first.development).toMatchObject({ state: "shipped", release: "1.6.0-beta.1" });
    expect(first.stable).toMatchObject({ state: "pending" });
    const fixed = find(graph.changes, "fix(server): crash on start");
    expect(fixed.development).toMatchObject({ state: "shipped", release: "1.6.0-beta.2" });
    expect(fixed.stable).toMatchObject({ state: "shipped", via: "backport", release: "1.5.1" });
    const second = find(graph.changes, "feat: second feature");
    expect(second.development).toMatchObject({ state: "landed", release: null });
    const hot = find(graph.changes, "fix: stable-only hotfix");
    expect(hot.development).toMatchObject({ state: "absent" });
    expect(graph.changes.find((c) => c.subject.startsWith("chore(release)"))).toBeUndefined();
    expect(graph.changes.find((c) => c.subject === "feat(ui): first feature")).toMatchObject({
      type: "feat",
      scope: "ui",
      origin: "development",
    });

    const flows = Object.fromEntries(graph.flows.map((f) => [f.kind, f]));
    expect(flows.promote).toMatchObject({ from: "development", to: "stable", pending: 2 });
    expect(flows["forward-port"]).toMatchObject({ from: "stable", to: "development", pending: 1 });
    expect(graph.events).toContainEqual(
      expect.objectContaining({ kind: "backport", toRelease: "1.5.1", count: 1 }),
    );

    // Promote: copy main up onto stable and cut 1.6.0.
    // The stable-only hotfix reaches main first, or promotion would drop it.
    const hotfix = git(work, "rev-parse", "stable");
    git(work, "switch", "-q", "main");
    git(work, "cherry-pick", "-x", hotfix);
    git(work, "switch", "-q", "stable");
    git(work, "merge", "-q", "--no-ff", "--no-commit", "-s", "ours", "main");
    git(work, "read-tree", "-u", "--reset", "main");
    git(work, "commit", "-qm", "chore(release): promote main 1.6.0-beta.2 to stable");
    commit(work, "p.txt", "chore(release): cut 1.6.0", "1.6.0");
    tag(work, "v1.6.0");
    git(work, "push", "-q", "origin", "main", "stable", "--tags");

    const after = await buildReleaseStreamsGraph({ git: runner(work), config });
    expect(find(after.changes, "feat(ui): first feature").stable).toMatchObject({
      state: "shipped",
      via: "promotion",
      release: "1.6.0",
    });
    expect(after.flows.find((f) => f.kind === "promote")?.pending).toBe(0);
    // Backports and the hotfix from before the promotion are not stranded afterwards.
    expect(after.flows.find((f) => f.kind === "forward-port")).toBeUndefined();
    commit(work, "late.txt", "fix: after the promotion");
    git(work, "push", "-q", "origin", "stable");
    const later = await buildReleaseStreamsGraph({ git: runner(work), config });
    expect(later.flows.find((f) => f.kind === "forward-port")).toMatchObject({ pending: 1 });
    expect(after.events).toContainEqual(
      expect.objectContaining({ kind: "promote", fromRelease: "1.6.0-beta.2", toRelease: "1.6.0" }),
    );
  });

  test("before a stable branch exists, stable history comes from the development branch", async () => {
    const { work } = product();
    git(work, "branch", "-D", "stable");
    commit(work, "a.txt", "feat: next thing");
    git(work, "push", "-q", "origin", "main", "--tags");
    const config = resolveReleaseStreamsConfig({ raw: null, remotes: ["origin"] });
    const graph = await buildReleaseStreamsGraph({ git: runner(work), config });
    const stable = graph.streams.find((s) => s.id === "stable")!;
    expect(stable).toMatchObject({ exists: false, version: "1.5.0" });
    expect(stable.releases.map((r) => r.version)).toEqual(["1.5.0"]);
    expect(graph.flows[0]).toMatchObject({ kind: "promote", command: "npm run streams -- init" });
  });

  test("a fork sees incoming upstream changes and its own contribution candidates", async () => {
    const upstream = product();
    git(upstream.work, "push", "-q", "origin", "main", "stable", "--tags");
    const fork = path.join(upstream.root, "fork");
    git(upstream.root, "clone", "-q", "--bare", path.join(upstream.root, "origin.git"), "fork.git");
    git(upstream.root, "clone", "-q", path.join(upstream.root, "fork.git"), fork);
    git(fork, "remote", "add", "upstream", path.join(upstream.root, "origin.git"));
    git(
      fork,
      "fetch",
      "-q",
      "--no-tags",
      "upstream",
      "+refs/heads/*:refs/remotes/upstream/*",
      "+refs/tags/*:refs/remotes/upstream/tags/*",
    );
    commit(fork, "fork.txt", "feat: fork-only feature");
    git(fork, "push", "-q", "origin", "main");

    commit(upstream.work, "u.txt", "feat: upstream feature");
    git(upstream.work, "push", "-q", "origin", "main");
    git(
      fork,
      "fetch",
      "-q",
      "--no-tags",
      "upstream",
      "+refs/heads/*:refs/remotes/upstream/*",
      "+refs/tags/*:refs/remotes/upstream/tags/*",
    );

    const config = resolveReleaseStreamsConfig({
      raw: { upstream: { follow: "development" } },
      remotes: ["origin", "upstream"],
    });
    const graph = await buildReleaseStreamsGraph({ git: runner(fork), config });
    expect(graph.streams.map((s) => s.id)).toEqual([
      "upstream-stable",
      "upstream-development",
      "stable",
      "development",
    ]);
    expect(graph.streams[0]!.releases.map((r) => r.version)).toEqual(["1.5.0"]);
    const incoming = find(graph.changes, "feat: upstream feature");
    expect(incoming.development).toMatchObject({ state: "pending" });
    expect(incoming["upstream-development"]).toMatchObject({ state: "landed" });
    const own = find(graph.changes, "feat: fork-only feature");
    expect(own["upstream-development"]).toMatchObject({ state: "absent" });
    const flows = Object.fromEntries(graph.flows.map((f) => [f.kind, f]));
    expect(flows.sync).toMatchObject({ from: "upstream-development", pending: 1 });
    expect(flows.contribute).toMatchObject({ to: "upstream-development", pending: 1 });
  });

  test("fork rebuild tags are stable and channel-part tags are betas", async () => {
    const { work } = product();
    commit(work, "s.txt", "chore(release): cut 1.5.0-acme.1", "1.5.0-acme.1");
    tag(work, "v1.5.0-acme.1");
    git(work, "branch", "-f", "stable");
    commit(work, "a.txt", "feat: fork feature");
    commit(work, "p.txt", "chore(release): cut 1.6.0-rc.1.acme.1", "1.6.0-rc.1.acme.1");
    tag(work, "v1.6.0-rc.1.acme.1");
    commit(work, "q.txt", "chore(release): cut 1.6.0-beta.2.acme.1", "1.6.0-beta.2.acme.1");
    tag(work, "v1.6.0-beta.2.acme.1");
    git(work, "push", "-q", "origin", "main", "stable", "--tags");
    const config = resolveReleaseStreamsConfig({ raw: null, remotes: ["origin"] });
    const graph = await buildReleaseStreamsGraph({ git: runner(work), config });
    const streams = Object.fromEntries(graph.streams.map((s) => [s.id, s]));
    expect(streams.stable!.releases.map((r) => r.version)).toEqual(["1.5.0-acme.1", "1.5.0"]);
    expect(streams.development!.releases.map((r) => r.version)).toEqual([
      "1.6.0-rc.1.acme.1",
      "1.6.0-beta.2.acme.1",
    ]);
    expect(find(graph.changes, "feat: fork feature").development).toMatchObject({
      state: "shipped",
      release: "1.6.0-rc.1.acme.1",
    });
  });

  test("config defaults and upstream detection", () => {
    expect(resolveReleaseStreamsConfig({ raw: null, remotes: ["origin"] })).toEqual({
      development: "main",
      stable: "stable",
      upstream: null,
      declared: false,
    });
    expect(
      resolveReleaseStreamsConfig({ raw: null, remotes: ["origin", "upstream"] }).upstream,
    ).toMatchObject({ remote: "upstream", follow: "stable" });
    expect(
      resolveReleaseStreamsConfig({
        raw: { upstream: { remote: "frogg" } },
        remotes: ["origin"],
      }).upstream,
    ).toBeNull();
  });
});
