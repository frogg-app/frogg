import type { ProviderOptions, ToolPolicy } from "@frogg/protocol/agent-types";
import { z } from "zod";

const PermissionRulesSchema = z
  .object({
    allow: z.array(z.string()).optional(),
    ask: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict();

const SandboxNetworkSchema = z
  .object({
    allowedDomains: z.array(z.string()).optional(),
    deniedDomains: z.array(z.string()).optional(),
    strictAllowlist: z.boolean().optional(),
    allowManagedDomainsOnly: z.boolean().optional(),
    allowUnixSockets: z.array(z.string()).optional(),
    allowAllUnixSockets: z.boolean().optional(),
    allowLocalBinding: z.boolean().optional(),
    allowMachLookup: z.array(z.string()).optional(),
    httpProxyPort: z.number().int().positive().optional(),
    socksProxyPort: z.number().int().positive().optional(),
    tlsTerminate: z
      .object({
        caCertPath: z.string().optional(),
        caKeyPath: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const SandboxFilesystemSchema = z
  .object({
    allowWrite: z.array(z.string()).optional(),
    denyWrite: z.array(z.string()).optional(),
    denyRead: z.array(z.string()).optional(),
    allowRead: z.array(z.string()).optional(),
    allowManagedReadPathsOnly: z.boolean().optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

/**
 * Flags the SDK sets itself to drive the session's stream, resume and permission protocol.
 * Passing them again as extra args would break or silently fork the session.
 */
export const CLAUDE_RESERVED_EXTRA_ARGS: ReadonlySet<string> = new Set([
  "continue",
  "fork-session",
  "include-partial-messages",
  "input-format",
  "mcp-config",
  "model",
  "output-format",
  "permission-mode",
  "permission-prompt-tool",
  "print",
  "replay-user-messages",
  "resume",
  "session-id",
  "setting-sources",
  "verbose",
]);

/**
 * Extra Claude Code CLI flags (`--chrome` → `{ chrome: null }`), as the SDK's `extraArgs`:
 * names without the leading dashes, `null` for a bare switch.
 */
const ExtraArgsSchema = z.record(z.string(), z.string().nullable()).superRefine((args, ctx) => {
  for (const name of Object.keys(args)) {
    if (!/^[a-z][a-z0-9-]*$/.test(name))
      ctx.addIssue({
        code: "custom",
        path: [name],
        message: "Extra Claude flags are lower-case names without the leading dashes",
      });
    else if (CLAUDE_RESERVED_EXTRA_ARGS.has(name))
      ctx.addIssue({ code: "custom", path: [name], message: "Frogg sets this Claude flag itself" });
  }
});

// Claude Agent SDK Options, maintained against @anthropic-ai/claude-agent-sdk 0.3.246.
export const ClaudeProviderOptionsSchema = z
  .object({
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    additionalDirectories: z.array(z.string()).optional(),
    extraArgs: ExtraArgsSchema.optional(),
    sandbox: z
      .object({
        enabled: z.boolean().optional(),
        failIfUnavailable: z.boolean().optional(),
        autoAllowBashIfSandboxed: z.boolean().optional(),
        excludedCommands: z.array(z.string()).optional(),
        allowUnsandboxedCommands: z.boolean().optional(),
        network: SandboxNetworkSchema.optional(),
        filesystem: SandboxFilesystemSchema.optional(),
        ignoreViolations: z.record(z.string(), z.array(z.string())).optional(),
        enableWeakerNestedSandbox: z.boolean().optional(),
        ripgrep: z
          .object({ command: z.string(), args: z.array(z.string()).optional() })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    settings: z
      .object({
        permissions: PermissionRulesSchema.optional(),
        sandbox: z
          .object({
            enabled: z.boolean().optional(),
            failIfUnavailable: z.boolean().optional(),
            autoAllowBashIfSandboxed: z.boolean().optional(),
            excludedCommands: z.array(z.string()).optional(),
            allowUnsandboxedCommands: z.boolean().optional(),
            network: SandboxNetworkSchema.optional(),
            filesystem: SandboxFilesystemSchema.optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict() satisfies z.ZodType<ProviderOptions>;

export type ClaudeProviderOptions = z.infer<typeof ClaudeProviderOptionsSchema>;

export function applyClaudeToolPolicy(
  options: ClaudeProviderOptions,
  toolPolicy: ToolPolicy | undefined,
): ClaudeProviderOptions {
  if (!toolPolicy) return options;
  const allowedTools = Array.isArray(options.allowedTools)
    ? options.allowedTools.filter((tool): tool is string => typeof tool === "string")
    : [];
  const grants = toolPolicy.preapproved.map((grant) => `mcp__${grant.server}__${grant.tool}`);
  return { ...options, allowedTools: [...new Set([...allowedTools, ...grants])] };
}
