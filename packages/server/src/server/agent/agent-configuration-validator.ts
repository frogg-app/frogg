import type { ProviderOptions } from "@frogg/protocol/agent-types";
import type { HubExecutionAgentValidationIssue } from "@frogg/protocol/messages";

import type { ProviderSnapshotEntry } from "./agent-sdk-types.js";
import { filterSelectableAgentModels } from "./agent-sdk-types.js";
import { ProviderOptionsValidationError } from "./provider-options.js";

export interface AgentConfigurationValidationInput {
  provider: string;
  /**
   * COMPAT(providerAccountAllowedModels): added in v1.4.2, remove after 2027-09-17.
   * The account the agent runs as. `null` is the provider's implicit default
   * account; omitted is the provider's daemon-wide active account.
   */
  providerAccountId?: string | null;
  model?: string;
  modeId?: string;
  thinkingOptionId?: string;
  providerOptions?: ProviderOptions;
}

interface AgentConfigurationValidationContext {
  input: AgentConfigurationValidationInput;
  provider: ProviderSnapshotEntry;
  validateOptions(options: ProviderOptions | undefined): ProviderOptions | undefined;
  /**
   * Model ids the agent's provider account permits, or undefined for no
   * restriction. An empty array permits nothing. The effective set is the
   * provider's selectable models intersected with this list.
   */
  allowedModels?: readonly string[] | undefined;
}

export function validateAgentConfigurationAgainstProvider({
  input,
  provider,
  validateOptions,
  allowedModels,
}: AgentConfigurationValidationContext): HubExecutionAgentValidationIssue[] {
  const issues: HubExecutionAgentValidationIssue[] = [];
  const providerModels = filterSelectableAgentModels(provider.models);
  // COMPAT(providerAccountAllowedModels): added in v1.4.2, remove after 2027-09-17.
  const models = allowedModels
    ? providerModels.filter((model) => isModelAllowed(model, allowedModels))
    : providerModels;
  const requestedModel = input.model;
  const selectedModel = requestedModel
    ? models.find((model) => model.id === requestedModel || model.aliases?.includes(requestedModel))
    : (models.find((model) => model.isDefault) ?? models[0]);

  if (requestedModel && !selectedModel) {
    const blockedByAccount = providerModels.some(
      (model) => model.id === requestedModel || model.aliases?.includes(requestedModel),
    );
    issues.push({
      path: ["model"],
      message: blockedByAccount
        ? `Model '${requestedModel}' is not permitted for the selected account on provider '${input.provider}'`
        : `Model '${requestedModel}' is not available for provider '${input.provider}'`,
    });
  } else if (!requestedModel && allowedModels && models.length === 0) {
    issues.push({
      path: ["model"],
      message: `The selected account on provider '${input.provider}' permits no models`,
    });
  }
  if (input.modeId && !provider.modes?.some((mode) => mode.id === input.modeId)) {
    issues.push({
      path: ["modeId"],
      message: `Mode '${input.modeId}' is not available for provider '${input.provider}'`,
    });
  }
  if (
    input.thinkingOptionId &&
    !selectedModel?.thinkingOptions?.some((option) => option.id === input.thinkingOptionId)
  ) {
    issues.push({
      path: ["thinkingOptionId"],
      message: `Thinking option '${input.thinkingOptionId}' is not available for provider '${input.provider}'`,
    });
  }

  try {
    validateOptions(input.providerOptions);
  } catch (error) {
    if (!(error instanceof ProviderOptionsValidationError)) throw error;
    issues.push(
      ...error.issues.map((issue) => ({
        path: ["providerOptions", ...issue.path],
        message: issue.message,
      })),
    );
  }

  return issues;
}

/**
 * Whether a provider model is in the account's allow-list. Matching accepts the
 * model's canonical id or any of its aliases, so an allow-list written with the
 * alias a user sees keeps working when the canonical id changes.
 */
export function isModelAllowed(
  model: { id: string; aliases?: string[] },
  allowedModels: readonly string[],
): boolean {
  return (
    allowedModels.includes(model.id) ||
    (model.aliases?.some((alias) => allowedModels.includes(alias)) ?? false)
  );
}
