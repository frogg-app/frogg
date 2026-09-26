import type { ReleaseStreamsConfig } from "@frogg/protocol/messages";
import { runGitCommand } from "../../utils/run-git-command.js";
import { readReleaseStreamsRaw, resolveReleaseStreamsConfig } from "./config.js";
import { buildReleaseStreamsGraph, type ReleaseStreamsGraph, type StreamsGit } from "./graph.js";

export interface ReleaseStreamsResult extends ReleaseStreamsGraph {
  config: ReleaseStreamsConfig;
  fetchedAt: string | null;
  fetchError: string | null;
}

/** Panes open on the same repo share one computation for this long. */
const SHARED_TTL_MS = 10_000;
/** A fetch touches the network; clicking refresh repeatedly does not fetch more often. */
const FETCH_INTERVAL_MS = 60_000;

interface Entry {
  inFlight: Promise<ReleaseStreamsResult> | null;
  result: ReleaseStreamsResult | null;
  computedAt: number;
  fetchedAt: number | null;
}

const entries = new Map<string, Entry>();

function gitIn(repoRoot: string, timeout = 30_000): StreamsGit {
  return async (args) => (await runGitCommand(args, { cwd: repoRoot, timeout })).stdout.trim();
}

/**
 * Refresh origin's stream branches and tags, and upstream's branches with its tags kept under
 * refs/remotes/<remote>/tags/ (a fork ships upstream's version numbers, so they would collide in
 * refs/tags). Mirrors fetchUpstream in scripts/release/streams.mjs.
 */
async function fetchStreams(repoRoot: string, config: ReleaseStreamsConfig): Promise<void> {
  const git = gitIn(repoRoot, 90_000);
  await git(["fetch", "--quiet", "--tags", "origin"]);
  if (config.upstream) {
    const { remote } = config.upstream;
    await git([
      "fetch",
      "--quiet",
      "--no-tags",
      remote,
      `+refs/heads/*:refs/remotes/${remote}/*`,
      `+refs/tags/*:refs/remotes/${remote}/tags/*`,
    ]);
  }
}

export async function getReleaseStreams(input: {
  repoRoot: string;
  fetch?: boolean;
  now?: () => number;
}): Promise<ReleaseStreamsResult> {
  const now = input.now ?? Date.now;
  const entry: Entry = entries.get(input.repoRoot) ?? {
    inFlight: null,
    result: null,
    computedAt: 0,
    fetchedAt: null,
  };
  entries.set(input.repoRoot, entry);
  const wantsFetch =
    input.fetch === true &&
    (entry.fetchedAt === null || now() - entry.fetchedAt > FETCH_INTERVAL_MS);
  if (entry.inFlight) return entry.inFlight;
  if (!wantsFetch && entry.result && now() - entry.computedAt < SHARED_TTL_MS) return entry.result;

  entry.inFlight = (async () => {
    const git = gitIn(input.repoRoot);
    const remotes = (await git(["remote"])).split("\n").filter(Boolean);
    const config = resolveReleaseStreamsConfig({
      raw: readReleaseStreamsRaw(input.repoRoot),
      remotes,
    });
    let fetchError: string | null = null;
    if (wantsFetch) {
      try {
        await fetchStreams(input.repoRoot, config);
        entry.fetchedAt = now();
      } catch (error) {
        fetchError = error instanceof Error ? error.message.split("\n")[0]! : String(error);
      }
    }
    const graph = await buildReleaseStreamsGraph({ git, config });
    return {
      ...graph,
      config,
      fetchedAt: entry.fetchedAt === null ? null : new Date(entry.fetchedAt).toISOString(),
      fetchError,
    };
  })();
  try {
    entry.result = await entry.inFlight;
    entry.computedAt = now();
    return entry.result;
  } finally {
    entry.inFlight = null;
  }
}

/** Test seam. */
export function resetReleaseStreamsState(): void {
  entries.clear();
}
