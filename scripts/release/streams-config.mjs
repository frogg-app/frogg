// Release streams: which branch cuts which channel, and where upstream lives for a fork.
// Read from the `streams` block of frogg.json. The daemon parses the same block
// (packages/protocol/src/frogg-config-schema.ts, FroggStreamsConfigSchema); keep the
// defaults here and there in step (streams-config.test.mjs checks the examples in the docs).
import { readFileSync } from "node:fs";
import { UPSTREAM_CHANNELS, releaseLineOfVersion } from "./release-channel.mjs";
import path from "node:path";

export const DEFAULT_STREAMS = Object.freeze({
  development: "main",
  stable: "stable",
  next: "frogg-next",
});

const branchPattern = /^[A-Za-z0-9._/-]+$/;

function branchName(value, fallback, label) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !branchPattern.test(value) || value.startsWith("-")) {
    throw new Error(
      `frogg.json streams.${label} must be a branch name, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Normalises a frogg.json `streams` block.
 *
 *   development  branch whose commits ship as betas (default "main")
 *   stable       branch whose commits ship as stable releases (default "stable")
 *   next         branch whose commits ship as Frogg Next prereleases, X.Y.Z-next.N (default
 *                "frogg-next"); it follows the development branch's version line
 *   upstream     for a fork: the remote it pulls from, that remote's two branches, which of
 *                them the fork's development branch follows ("stable" by default: pull tested
 *                upstream releases; "development" to test upstream betas as they land), and
 *                the fork's build suffix ("acme": releases are 1.8.0-acme.N, betas
 *                1.8.0-rc.1.acme.N), which keeps fork versions on upstream's numbers
 */
export function resolveStreamsConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const development = branchName(input.development, DEFAULT_STREAMS.development, "development");
  const stable = branchName(input.stable, DEFAULT_STREAMS.stable, "stable");
  if (development === stable) {
    throw new Error("frogg.json streams.development and streams.stable must be different branches");
  }
  const next = branchName(input.next, DEFAULT_STREAMS.next, "next");
  if (next === development || next === stable) {
    throw new Error(
      "frogg.json streams.next must differ from streams.development and streams.stable",
    );
  }
  let upstream = null;
  if (input.upstream && typeof input.upstream === "object") {
    const u = input.upstream;
    const follow = u.follow ?? "stable";
    if (follow !== "stable" && follow !== "development") {
      throw new Error('frogg.json streams.upstream.follow must be "stable" or "development"');
    }
    if (u.repository !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(u.repository)) {
      throw new Error("frogg.json streams.upstream.repository must be owner/name");
    }
    const suffix = u.suffix ?? null;
    if (
      suffix !== null &&
      (typeof suffix !== "string" ||
        !/^[a-z][a-z0-9]*$/.test(suffix) ||
        UPSTREAM_CHANNELS.includes(suffix))
    ) {
      throw new Error(
        'frogg.json streams.upstream.suffix must be a lowercase word that is not a channel name ("acme", not "beta")',
      );
    }
    upstream = {
      remote: branchName(u.remote, "upstream", "upstream.remote"),
      suffix,
      repository: u.repository ?? null,
      development: branchName(u.development, DEFAULT_STREAMS.development, "upstream.development"),
      stable: branchName(u.stable, DEFAULT_STREAMS.stable, "upstream.stable"),
      follow,
    };
  }
  return { development, stable, next, upstream };
}

export function readStreamsConfig(rootDir) {
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(path.join(rootDir, "frogg.json"), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return resolveStreamsConfig(raw.streams);
}

/** The upstream ref a fork's development branch merges from. */
export function upstreamFollowRef(config) {
  if (!config.upstream) return null;
  const branch =
    config.upstream.follow === "development" ? config.upstream.development : config.upstream.stable;
  return `${config.upstream.remote}/${branch}`;
}

/**
 * Frogg Next prereleases (`-next.N`) ship from the next branch, other betas (`-beta.3`,
 * `-rc.1.acme.2`) from the development branch, stable releases, fork rebuilds included
 * (`-acme.2`), from the stable branch.
 */
export function branchForVersion(config, version) {
  const line = releaseLineOfVersion(version);
  if (line === "next") return config.next;
  return line === "beta" ? config.development : config.stable;
}

/** The release line a branch ships: stable, next (Frogg Next) or, for anything else, beta. */
export function lineForBranch(config, branch) {
  if (branch === config.stable) return "stable";
  return branch === config.next ? "next" : "beta";
}

/**
 * The classic app's brand channel for builds of a branch: the stable branch builds the stable
 * app, anything else frogg beta. Pull requests and test builds of the next branch never publish.
 */
export function channelForBranch(config, branch) {
  return branch === config.stable ? "stable" : "beta";
}
