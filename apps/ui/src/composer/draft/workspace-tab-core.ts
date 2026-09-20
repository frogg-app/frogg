import { resolveSubmissionReadiness } from "@/provider-selection/provider-selection";

export interface WorkspaceDraftAutoSubmitConfig {
  provider: string;
  model: string | null;
}

export function shouldAllowEmptyDraftText(input: {
  allowsEmptyAutoSubmit: boolean;
  attachments: readonly unknown[];
}): boolean {
  return input.allowsEmptyAutoSubmit || input.attachments.length > 0;
}

export function validateDraftSubmission(input: {
  text: string;
  allowsEmptyAutoSubmit: boolean;
  composerState: {
    providerDefinitions: unknown[];
    selectedProvider: string | null;
    isModelLoading: boolean;
    effectiveModelId: string | null;
    availableModels: unknown[];
  };
  autoSubmitConfig: WorkspaceDraftAutoSubmitConfig | null;
  workspaceDirectory: string | null;
  hasClient: boolean;
}): string | null {
  const {
    text,
    allowsEmptyAutoSubmit,
    composerState,
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  } = input;
  const readiness = resolveSubmissionReadiness({
    text,
    allowsEmptyAutoSubmit,
    providerCount: composerState.providerDefinitions.length,
    selection: {
      provider: composerState.selectedProvider,
      modelId: composerState.effectiveModelId ?? "",
      availableModels: composerState.availableModels,
      isModelLoading: composerState.isModelLoading,
    },
    autoSubmitConfig,
    workspaceDirectory,
    hasClient,
  });
  return readiness.ok ? null : (readiness.reason ?? null);
}

/**
 * The launch config's `providerAccountId` key, or nothing at all when neither
 * the launching surface nor this composer named an account — a provider with no
 * accounts must leave the key off entirely, which is how daemons without the
 * accounts capability are addressed.
 */
export function resolveDraftProviderAccountOverride(input: {
  autoSubmitConfig: { providerAccountId?: string | null } | null;
  composerAccountId: string | null | undefined;
}): { providerAccountId?: string | null } {
  const fromLaunch = input.autoSubmitConfig?.providerAccountId;
  if (fromLaunch !== undefined) return { providerAccountId: fromLaunch };
  return input.composerAccountId !== undefined
    ? { providerAccountId: input.composerAccountId }
    : {};
}
