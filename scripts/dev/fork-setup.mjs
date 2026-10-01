#!/usr/bin/env node
// Sets up a checkout as a branded fork that follows upstream Frogg: the upstream remote, its
// branches and tags, the `streams.upstream` block in frogg.json, and the stable branch. Safe to
// re-run: every step checks what is already there and only changes what differs.
//
//   npm run fork:setup -- --suffix acme --dry-run     show the plan
//   npm run fork:setup -- --suffix acme               apply it
//   npm run fork:setup -- --suffix acme --init-stable also create the stable branch
//
// website/src/content/docs/docs/fork-and-rebrand/branded-development.mdx is the guide.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStreamsConfig } from "../release/streams-config.mjs";
import { portableCommand } from "./npm-command.mjs";

export const DEFAULT_UPSTREAM_URL = "https://github.com/frogg-app/frogg.git";

export const USAGE = `usage: npm run fork:setup -- [options]

Configures this checkout as a branded fork that follows upstream Frogg:
  1. adds the upstream remote, or checks the one that is there
  2. fetches upstream branches, and its tags into refs/remotes/<remote>/tags/
  3. writes streams.upstream into frogg.json (commit it on your development branch)
  4. reports your development and stable branches; --init-stable creates stable

Options:
  --upstream-url <url>          upstream repository (default ${DEFAULT_UPSTREAM_URL})
  --remote <name>               remote name (default upstream)
  --repository <owner/name>     upstream repository for pull requests (default: from the URL)
  --follow stable|development   what release:sync-upstream merges (default stable)
  --suffix <word>               your build counter: 1.8.0-<word>.1 (recommended)
  --brand <dir>                 also run brand:check on this brand directory
  --init-stable                 create the stable branch from the newest stable tag
  --no-fetch                    do not fetch upstream
  --dry-run                     print the plan and change nothing
  --help                        show this help`;

const VALUE_OPTIONS = new Set([
  "--upstream-url",
  "--remote",
  "--repository",
  "--follow",
  "--suffix",
  "--brand",
]);
const FLAG_OPTIONS = new Set(["--init-stable", "--no-fetch", "--dry-run", "--help", "-h"]);

export function parseArgs(argv) {
  const options = {
    upstreamUrl: undefined,
    remote: undefined,
    repository: undefined,
    follow: undefined,
    suffix: undefined,
    brand: undefined,
    initStable: false,
    fetch: true,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inline] = arg.includes("=") ? arg.split(/=(.*)/su) : [arg, undefined];
    if (VALUE_OPTIONS.has(name)) {
      const value = inline ?? argv[++index];
      if (value === undefined || value.startsWith("--")) throw new Error(`${name} needs a value`);
      const key = { "--upstream-url": "upstreamUrl" }[name] ?? name.slice(2);
      options[key] = value;
    } else if (FLAG_OPTIONS.has(name)) {
      if (name === "--init-stable") options.initStable = true;
      else if (name === "--no-fetch") options.fetch = false;
      else if (name === "--dry-run") options.dryRun = true;
      else options.help = true;
    } else {
      throw new Error(`Unknown option ${arg}. Run with --help.`);
    }
  }
  return options;
}

/** `owner/name` from a GitHub-style URL (https, ssh or scp form), or null. */
export function repositoryFromUrl(url) {
  const value = url.trim();
  // Only hosted remotes name a repository; a local path does not.
  if (!/^[a-z+]+:\/\//u.test(value) && !/^[\w.-]+@[\w.-]+:/u.test(value)) return null;
  const match = /[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u.exec(value);
  return match ? `${match[1]}/${match[2]}` : null;
}

/**
 * frogg.json with `streams.upstream` merged in. Options left unset keep what the file already
 * says, so a re-run with fewer flags never drops a setting. Returns the new object and whether
 * it differs from the input. Throws when the result is not a valid streams block.
 */
export function mergeUpstreamStreams(froggJson, options) {
  const current = froggJson?.streams?.upstream ?? {};
  const upstream = { ...current };
  upstream.remote = options.remote ?? current.remote ?? "upstream";
  const repository =
    options.repository ??
    current.repository ??
    (options.upstreamUrl ? repositoryFromUrl(options.upstreamUrl) : null);
  if (repository) upstream.repository = repository;
  upstream.follow = options.follow ?? current.follow ?? "stable";
  if (options.suffix !== undefined) upstream.suffix = options.suffix;
  const next = {
    ...froggJson,
    streams: { ...froggJson?.streams, upstream },
  };
  resolveStreamsConfig(next.streams);
  return { next, changed: JSON.stringify(next) !== JSON.stringify(froggJson) };
}

/** What to do about the remote: add it, keep it, or stop because it points elsewhere. */
export function planRemote(existingUrl, wantedUrl) {
  if (!existingUrl) return "add";
  const normalize = (url) =>
    url
      .trim()
      .replace(/\.git$/u, "")
      .replace(/\/$/u, "");
  return normalize(existingUrl) === normalize(wantedUrl) ? "keep" : "conflict";
}

function tools(root, options) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const gitTry = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : null;
  };
  const say = (line) => process.stdout.write(`${line}\n`);
  const act = (line) => say(options.dryRun ? `  would: ${line}` : `  ${line}`);
  return { git, gitTry, say, act };
}

function setUpRemote({ git, say, act }, options, { remote, remotePlan, existingUrl, upstreamUrl }) {
  if (remotePlan === "add") {
    act(`git remote add ${remote} ${upstreamUrl}`);
    if (!options.dryRun) git("remote", "add", remote, upstreamUrl);
  } else {
    say(`  remote ${remote} already points at ${existingUrl}`);
  }
  if (!options.fetch) return;
  // Upstream tags stay out of refs/tags: a fork reuses upstream's version numbers.
  act(`fetch ${remote} (branches, and tags into refs/remotes/${remote}/tags/)`);
  if (options.dryRun) return;
  git(
    "fetch",
    "--quiet",
    "--no-tags",
    remote,
    `+refs/heads/*:refs/remotes/${remote}/*`,
    `+refs/tags/*:refs/remotes/${remote}/tags/*`,
  );
}

function reportBranches({ gitTry, say, act }, options, root, config) {
  const hasRef = (ref) => gitTry("rev-parse", "--verify", "--quiet", ref) !== null;
  const hasBranch = (branch) =>
    hasRef(`refs/heads/${branch}`) || hasRef(`refs/remotes/origin/${branch}`);
  const presence = (branch) => (hasBranch(branch) ? "present" : "missing");
  say(`  development branch ${config.development}: ${presence(config.development)}`);
  if (hasBranch(config.stable)) {
    say(`  stable branch ${config.stable}: present`);
  } else if (options.initStable) {
    act(`npm run streams -- init  (create ${config.stable} from the newest stable tag)`);
    if (!options.dryRun) {
      const streams = path.join(root, "scripts/release/streams.mjs");
      const result = spawnSync(process.execPath, [streams, "init"], {
        cwd: root,
        stdio: "inherit",
      });
      if (result.status !== 0) throw new Error("streams init failed");
    }
  } else {
    say(`  stable branch ${config.stable}: missing (re-run with --init-stable to create it)`);
  }
  const { remote, follow, development, stable } = config.upstream;
  const followRef = `${remote}/${follow === "development" ? development : stable}`;
  if (options.fetch && !options.dryRun && !hasRef(followRef)) {
    say(`  warning: ${followRef} does not exist; release:sync-upstream will need --ref`);
  }
}

function checkBrand({ say, act }, options, root) {
  const brandDir = path.resolve(root, options.brand);
  if (!existsSync(path.join(brandDir, "brand.json"))) {
    say(`  brand ${options.brand}: no brand.json yet. Scaffold it with npm run brand:init`);
    return;
  }
  act(`npm run brand:check -- --brand ${options.brand}`);
  if (options.dryRun) return;
  const npm = portableCommand("npm", ["run", "--silent", "brand:check", "--", "--brand", brandDir]);
  const result = spawnSync(npm.command, npm.args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error("brand:check failed");
}

function run(root, options) {
  const io = tools(root, options);
  const { gitTry, say, act } = io;
  say(options.dryRun ? "Fork setup (dry run, nothing changes)" : "Fork setup");

  const froggPath = path.join(root, "frogg.json");
  const froggJson = existsSync(froggPath) ? JSON.parse(readFileSync(froggPath, "utf8")) : {};
  const remote = options.remote ?? froggJson?.streams?.upstream?.remote ?? "upstream";
  const existingUrl = gitTry("remote", "get-url", remote);
  // Without --upstream-url an existing remote is kept as it is (ssh or https alike).
  const upstreamUrl = options.upstreamUrl ?? existingUrl ?? DEFAULT_UPSTREAM_URL;
  const remotePlan = planRemote(existingUrl, upstreamUrl);
  // Validate everything before touching anything.
  const { next, changed } = mergeUpstreamStreams(froggJson, { ...options, remote, upstreamUrl });
  const config = resolveStreamsConfig(next.streams);
  if (remotePlan === "conflict") {
    throw new Error(
      `Remote "${remote}" points at ${existingUrl}, not ${upstreamUrl}. ` +
        `Drop --upstream-url to keep it, or change it with: git remote set-url ${remote} <url>`,
    );
  }

  setUpRemote(io, options, { remote, remotePlan, existingUrl, upstreamUrl });
  if (changed) {
    act(`write frogg.json streams.upstream = ${JSON.stringify(next.streams.upstream)}`);
    if (!options.dryRun) writeFileSync(froggPath, `${JSON.stringify(next, null, 2)}\n`);
  } else {
    say("  frogg.json streams.upstream already set");
  }
  if (!config.upstream.suffix) {
    say("  note: no --suffix, so your releases carry no build counter (see fork versions)");
  }
  reportBranches(io, options, root, config);
  if (options.brand) checkBrand(io, options, root);

  say("");
  say("Next:");
  if (changed) say(`  git add frogg.json && git commit -m "chore: follow upstream Frogg"`);
  say("  npm run streams                  where each stream is");
  say("  npm run release:sync-upstream    merge upstream into your development branch");
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${USAGE}\n`);
    } else {
      const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8",
      }).trim();
      run(root, options);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
