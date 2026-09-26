import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const FroggServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const FroggLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const FroggScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
  })
  .passthrough();

export const FroggWorktreeConfigRawSchema = z
  .object({
    setup: FroggLifecycleCommandRawSchema.optional(),
    teardown: FroggLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: FroggServicePortAllocationSchema.optional(),
  })
  .passthrough();

export const FroggMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const FroggMetadataGenerationSchema = z
  .object({
    title: FroggMetadataGenerationEntrySchema.optional(),
    branchName: FroggMetadataGenerationEntrySchema.optional(),
    commitMessage: FroggMetadataGenerationEntrySchema.optional(),
    pullRequest: FroggMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy frogg.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

/**
 * CI providers for the explorer's CI tab. GitHub Actions needs no entry: it is read through the
 * `gh` CLI whenever the checkout's remote is on GitHub. Jenkins credentials never live here —
 * the daemon reads them from FROGG_JENKINS_USER / FROGG_JENKINS_TOKEN.
 */
export const FroggCiConfigSchema = z
  .object({
    githubActions: z.boolean().optional(),
    jenkins: z
      .object({
        url: z.string(),
        /** Job path, folders separated by "/", e.g. "team/frogg-daemon". */
        job: z.string(),
        /** A multibranch pipeline: builds live under job/<branch>. Defaults to true. */
        multibranch: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();

/**
 * Release streams: which branch cuts betas and which cuts stable releases, and for a fork, the
 * upstream it pulls from. The release scripts (scripts/release/streams-config.mjs) and the
 * daemon's stream graph read the same block; both default development to "main" and stable to
 * "stable", and a fork's upstream to the "upstream" remote following upstream's stable releases.
 */
export const FroggStreamsConfigSchema = z
  .object({
    development: z.string().optional(),
    stable: z.string().optional(),
    upstream: z
      .object({
        remote: z.string().optional(),
        /** owner/name, for opening pull requests upstream. */
        repository: z.string().optional(),
        development: z.string().optional(),
        stable: z.string().optional(),
        follow: z.enum(["stable", "development"]).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const FroggConfigRawSchema = z
  .object({
    worktree: FroggWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), FroggScriptEntryRawSchema).optional(),
    metadataGeneration: FroggMetadataGenerationSchema.optional(),
    ci: FroggCiConfigSchema.optional(),
    streams: FroggStreamsConfigSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = FroggWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = FroggScriptEntryRawSchema.catch({});

export const FroggConfigSchema = FroggConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: FroggMetadataGenerationSchema.optional(),
  // A malformed ci block must not take the rest of the config down with it.
  ci: FroggCiConfigSchema.optional().catch(undefined),
  streams: FroggStreamsConfigSchema.optional().catch(undefined),
})
  .passthrough()
  .catch({});

// Filesystem timestamps are too coarse on their own: tmpfs and other
// coarse-clock filesystems can stamp two consecutive writes with the same
// mtime, so a same-size edit would slip past the stale-write guard. The
// content hash is the authoritative part of the token; mtime and size remain
// for display and for tokens minted by older clients.
export const FroggConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
  contentHash: z.string().optional(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: FroggConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

export type FroggScriptEntryRaw = z.infer<typeof FroggScriptEntryRawSchema>;
export type FroggMetadataGenerationEntry = z.infer<typeof FroggMetadataGenerationEntrySchema>;
export type FroggMetadataGeneration = z.infer<typeof FroggMetadataGenerationSchema>;
export type FroggServicePortAllocation = z.infer<typeof FroggServicePortAllocationSchema>;
export type FroggConfigRaw = z.infer<typeof FroggConfigRawSchema>;
export type FroggConfig = z.infer<typeof FroggConfigSchema>;
export type FroggCiConfig = z.infer<typeof FroggCiConfigSchema>;
export type FroggStreamsConfig = z.infer<typeof FroggStreamsConfigSchema>;
export type FroggConfigRevision = z.infer<typeof FroggConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
