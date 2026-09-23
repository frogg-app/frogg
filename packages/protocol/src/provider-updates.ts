/**
 * Describes how each agent provider is distributed, so the daemon can report the
 * installed version, discover the latest published one, and run an update.
 *
 * Providers ship through different channels (npm for most, a vendored native
 * installer for others), so the descriptor names the channel rather than
 * assuming npm everywhere.
 */

export type ProviderDistributionKind = "npm" | "unmanaged";

export interface ProviderUpdateDescriptor {
  /** Provider id as used everywhere else (matches AgentProviderDefinition.id). */
  provider: string;
  /** Executable names to probe on PATH, most canonical first. */
  binaryNames: string[];
  /** Arguments that make the binary print its version. */
  versionArgs: string[];
  kind: ProviderDistributionKind;
  /** npm package name, when `kind` is "npm". */
  npmPackage?: string;
  /** Shown when the provider cannot be updated by us. */
  manualInstallUrl?: string;
}

const NPM_VERSION_ARGS = ["--version"];

export const PROVIDER_UPDATE_DESCRIPTORS: ProviderUpdateDescriptor[] = [
  {
    provider: "claude",
    binaryNames: ["claude"],
    versionArgs: NPM_VERSION_ARGS,
    kind: "npm",
    npmPackage: "@anthropic-ai/claude-code",
    manualInstallUrl: "https://docs.claude.com/en/docs/claude-code/setup",
  },
  {
    provider: "codex",
    binaryNames: ["codex"],
    versionArgs: NPM_VERSION_ARGS,
    kind: "npm",
    npmPackage: "@openai/codex",
    manualInstallUrl: "https://github.com/openai/codex",
  },
  {
    provider: "copilot",
    binaryNames: ["copilot"],
    versionArgs: NPM_VERSION_ARGS,
    kind: "npm",
    npmPackage: "@github/copilot",
    manualInstallUrl: "https://github.com/github/copilot-cli",
  },
  {
    provider: "opencode",
    binaryNames: ["opencode"],
    versionArgs: NPM_VERSION_ARGS,
    kind: "npm",
    npmPackage: "opencode-ai",
    manualInstallUrl: "https://opencode.ai/docs",
  },
  {
    provider: "pi",
    binaryNames: ["pi"],
    versionArgs: NPM_VERSION_ARGS,
    kind: "unmanaged",
  },
  {
    provider: "omp",
    binaryNames: ["omp"],
    versionArgs: NPM_VERSION_ARGS,
    kind: "unmanaged",
  },
];

export function getProviderUpdateDescriptor(
  provider: string,
): ProviderUpdateDescriptor | undefined {
  return PROVIDER_UPDATE_DESCRIPTORS.find((entry) => entry.provider === provider);
}

/** Providers Frogg can install or upgrade on the user's behalf. */
export function isProviderUpdatable(descriptor: ProviderUpdateDescriptor): boolean {
  return descriptor.kind === "npm" && Boolean(descriptor.npmPackage);
}
