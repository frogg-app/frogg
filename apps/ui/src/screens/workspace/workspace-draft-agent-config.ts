import type { AgentSessionConfig } from "@frogg/protocol/agent-types";

export function buildWorkspaceDraftAgentConfig(input: {
  provider: AgentSessionConfig["provider"];
  cwd: string;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
  /**
   * COMPAT(perAgentProviderAccounts): three-valued. Absent leaves the key off the
   * wire so the daemon uses the provider's active account; `null` is the explicit
   * "Default" pick. Never test it for truthiness.
   */
  providerAccountId?: string | null;
}): AgentSessionConfig {
  return {
    provider: input.provider,
    cwd: input.cwd,
    ...(input.modeId ? { modeId: input.modeId } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.thinkingOptionId ? { thinkingOptionId: input.thinkingOptionId } : {}),
    ...(input.featureValues ? { featureValues: input.featureValues } : {}),
    ...("providerAccountId" in input && input.providerAccountId !== undefined
      ? { providerAccountId: input.providerAccountId }
      : {}),
  };
}
