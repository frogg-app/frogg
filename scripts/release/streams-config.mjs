// Release streams: which branch cuts which channel, and where upstream lives for a fork.
// Read from the `streams` block of frogg.json. The daemon parses the same block
// (packages/protocol/src/frogg-config-schema.ts, FroggStreamsConfigSchema); keep the
// defaults here and there in step (streams-config.test.mjs checks the examples in the docs).
import { readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_STREAMS = Object.freeze({
  development: "main",
  stable: "stable",
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
 *   upstream     for a fork: the remote it pulls from, that remote's two branches, and which of
 *                them the fork's development branch follows ("stable" by default: pull tested
 *                upstream releases; "development" to test upstream betas as they land)
 */
export function resolveStreamsConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const development = branchName(input.development, DEFAULT_STREAMS.development, "development");
  const stable = branchName(input.stable, DEFAULT_STREAMS.stable, "stable");
  if (development === stable) {
    throw new Error("frogg.json streams.development and streams.stable must be different branches");
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
    upstream = {
      remote: branchName(u.remote, "upstream", "upstream.remote"),
      repository: u.repository ?? null,
      development: branchName(u.development, DEFAULT_STREAMS.development, "upstream.development"),
      stable: branchName(u.stable, DEFAULT_STREAMS.stable, "upstream.stable"),
      follow,
    };
  }
  return { development, stable, upstream };
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

/** Stable tags ship from the stable branch, -beta.N tags from the development branch. */
export function branchForVersion(config, version) {
  return /-/.test(version.replace(/^v/, "")) ? config.development : config.stable;
}

/** Workflow builds of a branch: the stable branch builds the stable identity, anything else beta. */
export function channelForBranch(config, branch) {
  return branch === config.stable ? "stable" : "beta";
}
