import { FroggStreamsConfigSchema } from "@frogg/protocol/frogg-config-schema";
import type { ReleaseStreamsConfig } from "@frogg/protocol/messages";
import { readFroggConfigJson } from "../../utils/frogg-config-file.js";

const BRANCH = /^[A-Za-z0-9._/-]+$/;

function branch(value: string | undefined, fallback: string): string {
  return value && BRANCH.test(value) && !value.startsWith("-") ? value : fallback;
}

/**
 * frogg.json "streams", with the defaults scripts/release/streams-config.mjs applies. A checkout
 * that declares nothing still gets main/stable, and an "upstream" remote, when it has one, is
 * read as the upstream a fork follows: that is the usual shape of a GitHub fork checkout.
 */
export function resolveReleaseStreamsConfig(input: {
  raw: unknown;
  remotes: readonly string[];
}): ReleaseStreamsConfig {
  const parsed = FroggStreamsConfigSchema.safeParse(input.raw ?? {});
  const streams = parsed.success ? parsed.data : {};
  const development = branch(streams.development, "main");
  let stable = branch(streams.stable, "stable");
  if (stable === development) stable = development === "stable" ? "release" : "stable";
  const declaredUpstream = streams.upstream;
  const remote = branch(declaredUpstream?.remote, "upstream");
  const upstream =
    declaredUpstream || input.remotes.includes("upstream")
      ? {
          remote,
          repository:
            declaredUpstream?.repository && /^[\w.-]+\/[\w.-]+$/.test(declaredUpstream.repository)
              ? declaredUpstream.repository
              : null,
          development: branch(declaredUpstream?.development, "main"),
          stable: branch(declaredUpstream?.stable, "stable"),
          follow: declaredUpstream?.follow ?? "stable",
        }
      : null;
  return {
    development,
    stable,
    upstream: upstream && input.remotes.includes(upstream.remote) ? upstream : null,
    declared: parsed.success && input.raw !== undefined && input.raw !== null,
  };
}

export function readReleaseStreamsRaw(repoRoot: string): unknown {
  try {
    const json = readFroggConfigJson(repoRoot) as { streams?: unknown } | null;
    return json?.streams ?? null;
  } catch {
    return null;
  }
}
