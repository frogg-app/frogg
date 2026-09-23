/**
 * The Claude model catalog, as reported by the installed Claude Code.
 *
 * Every row here is generated: the SDK's `supportedModels()` names the models
 * the installed CLI actually accepts, along with the effort levels, fast mode
 * and adaptive thinking each one supports. Nothing is curated in this repo, so
 * a user who updates their CLI gets new models without waiting on a release,
 * and a model the CLI has dropped stops being offered.
 *
 * Capability gates elsewhere in the provider are synchronous and run on hot
 * paths (building query options, listing features), so the rows are also
 * recorded in a process-wide cache as they arrive. A model the cache has never
 * seen is treated as a custom model rather than as unsupported.
 */

import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";

import type { AgentModelDefinition, AgentSelectOption } from "../../agent-sdk-types.js";

export type ClaudeEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export const CLAUDE_DEFAULT_THINKING_OPTION_ID = "high";
export const CLAUDE_DISABLED_THINKING_OPTION_ID = "off";
export const CLAUDE_ULTRACODE_THINKING_OPTION_ID = "ultracode";

const CLAUDE_EFFORT_LABELS = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
} as const satisfies Record<ClaudeEffortLevel, string>;

/** Effort levels offered for a model whose capabilities the CLI did not report. */
const FALLBACK_EFFORT_LEVELS: readonly ClaudeEffortLevel[] = ["low", "medium", "high", "max"];

export interface ClaudeModelCapabilities {
  /** Ids this row answers to: its own value plus the wire id it resolves to. */
  ids: readonly string[];
  /** The CLI's own display name, so a model id can be shown as a label anywhere. */
  label: string;
  supportsFastMode: boolean;
  /** Thinking can be turned off entirely — Claude decides when to think instead. */
  supportsThinkingDisabled: boolean;
  effortLevels: readonly ClaudeEffortLevel[] | undefined;
}

function toEffortLevels(model: ModelInfo): readonly ClaudeEffortLevel[] | undefined {
  if (model.supportsEffort === false) return undefined;
  const reported = model.supportedEffortLevels;
  if (reported && reported.length > 0) return reported;
  return model.supportsEffort ? FALLBACK_EFFORT_LEVELS : undefined;
}

export function readClaudeModelCapabilities(model: ModelInfo): ClaudeModelCapabilities {
  const ids = [model.value, model.resolvedModel].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return {
    ids: Array.from(new Set(ids)),
    label: model.displayName,
    supportsFastMode: model.supportsFastMode === true,
    supportsThinkingDisabled: model.supportsAdaptiveThinking === true,
    effortLevels: toEffortLevels(model),
  };
}

export function buildClaudeThinkingOptions(
  effortLevels: readonly ClaudeEffortLevel[] | undefined,
  supportsThinkingDisabled: boolean,
): AgentSelectOption[] | undefined {
  if (!effortLevels || effortLevels.length === 0) return undefined;

  const options: AgentSelectOption[] = [
    ...(supportsThinkingDisabled ? [{ id: CLAUDE_DISABLED_THINKING_OPTION_ID, label: "Off" }] : []),
    ...effortLevels.map((id) => ({
      id,
      label: CLAUDE_EFFORT_LABELS[id],
      ...(id === CLAUDE_DEFAULT_THINKING_OPTION_ID ? { isDefault: true } : {}),
    })),
  ];

  // Ultra Code rides on the same extra-high capability the CLI reports.
  if (effortLevels.includes("xhigh")) {
    options.push({ id: CLAUDE_ULTRACODE_THINKING_OPTION_ID, label: "Ultra Code" });
  }

  return options;
}

/** Thinking options for a model the CLI never described — a custom or third-party id. */
export function getClaudeCustomModelThinkingOptions(): AgentSelectOption[] {
  return buildClaudeThinkingOptions(FALLBACK_EFFORT_LEVELS, false) as AgentSelectOption[];
}

export function buildClaudeModelDefinition(model: ModelInfo): AgentModelDefinition {
  const capabilities = readClaudeModelCapabilities(model);
  const definition: AgentModelDefinition = {
    provider: "claude",
    id: model.value,
    label: model.displayName,
    description: model.description,
  };
  // The CLI does not report a context window with the catalog, but it reports
  // one with every turn's usage, so a model already run on this daemon seeds
  // its own meter. A model never run yet has an empty meter until its first
  // result frame, which is where the real number comes from either way.
  const contextWindowMaxTokens = lookupClaudeContextWindow(model.value);
  if (contextWindowMaxTokens !== undefined) {
    definition.contextWindowMaxTokens = contextWindowMaxTokens;
  }
  // The canonical wire id is an alias rather than a row of its own, so a
  // session persisted under the explicit id still resolves to this entry.
  const aliases = capabilities.ids.filter((id) => id !== model.value);
  if (aliases.length > 0) definition.aliases = aliases;

  const thinkingOptions = buildClaudeThinkingOptions(
    capabilities.effortLevels,
    capabilities.supportsThinkingDisabled,
  );
  if (thinkingOptions) {
    definition.thinkingOptions = thinkingOptions;
    definition.defaultThinkingOptionId = CLAUDE_DEFAULT_THINKING_OPTION_ID;
  }
  return definition;
}

/**
 * Turn a reported catalog into model definitions, recording capabilities as it
 * goes. The CLI lists models most-preferred first, so the first row is the
 * default unless one is flagged.
 */
export function buildClaudeModelDefinitions(models: readonly ModelInfo[]): AgentModelDefinition[] {
  recordClaudeModelCapabilities(models);
  return models.map((model, index) => {
    const definition = buildClaudeModelDefinition(model);
    return index === 0 ? { ...definition, isDefault: true } : definition;
  });
}

// ---------------------------------------------------------------------------
// Capability cache
// ---------------------------------------------------------------------------

const capabilitiesById = new Map<string, ClaudeModelCapabilities>();

/** Whether any catalog has been read from the CLI in this process yet. */
export function hasClaudeModelCatalog(): boolean {
  return capabilitiesById.size > 0;
}

export function recordClaudeModelCapabilities(models: readonly ModelInfo[]): void {
  for (const model of models) {
    const capabilities = readClaudeModelCapabilities(model);
    for (const id of capabilities.ids) {
      capabilitiesById.set(id, capabilities);
    }
  }
}

/**
 * Capabilities for a model id, matched strictly.
 *
 * Strict means the id the CLI reported, or that id with a dated suffix — a
 * spelling of the same first-party model. A gateway-prefixed id
 * (`openrouter/anthropic/claude-opus-4-8`) is deliberately not a match: it names
 * a different endpoint that need not support what first-party Claude supports,
 * and a capability gate that guessed otherwise would offer a setting the model
 * rejects. Display code wants the looser {@link lookupClaudeModelByAnyId}.
 */
export function lookupClaudeModelCapabilities(
  modelId: string | null | undefined,
): ClaudeModelCapabilities | undefined {
  const trimmed = typeof modelId === "string" ? modelId.trim() : "";
  if (!trimmed) return undefined;
  const direct = capabilitiesById.get(trimmed);
  if (direct) return direct;
  const dated = trimmed.match(/^(.*)-\d{8}$/);
  return dated ? capabilitiesById.get(dated[1]) : undefined;
}

/**
 * Capabilities for a model id, matched loosely enough to recognise a first-party
 * model behind a gateway prefix. For display only — see the note above.
 */
export function lookupClaudeModelByAnyId(
  modelId: string | null | undefined,
): ClaudeModelCapabilities | undefined {
  const strict = lookupClaudeModelCapabilities(modelId);
  if (strict) return strict;
  const trimmed = typeof modelId === "string" ? modelId.trim() : "";
  if (!trimmed) return undefined;
  for (const [id, capabilities] of capabilitiesById) {
    if (trimmed.includes(id)) return capabilities;
  }
  return undefined;
}

export interface ClaudeDisabledThinkingResolution {
  supported: boolean;
  fallbackThinkingOptionId: string | undefined;
}

/**
 * Whether thinking can be turned off for a model, and what to fall back to when
 * it cannot.
 *
 * Within a catalog that has been read, a model that is not in it is a custom or
 * gateway model and does not get the setting. Before any catalog has been read
 * the answer is yes, because "not in the cache" then means "not asked yet" — a
 * session created before the first catalog refresh must not have a valid
 * setting rejected on the strength of an empty cache.
 */
export function resolveClaudeDisabledThinkingForModel(
  modelId: string | null | undefined,
): ClaudeDisabledThinkingResolution {
  if (!hasClaudeModelCatalog()) {
    return { supported: true, fallbackThinkingOptionId: undefined };
  }
  const capabilities = lookupClaudeModelCapabilities(modelId);
  if (!capabilities) {
    return { supported: false, fallbackThinkingOptionId: undefined };
  }
  return {
    supported: capabilities.supportsThinkingDisabled,
    fallbackThinkingOptionId: capabilities.effortLevels
      ? CLAUDE_DEFAULT_THINKING_OPTION_ID
      : undefined,
  };
}

/** The CLI's display name for a model id, or null when it never reported one. */
export function lookupClaudeModelLabel(modelId: string | null | undefined): string | null {
  return lookupClaudeModelByAnyId(modelId)?.label ?? null;
}

// ---------------------------------------------------------------------------
// Context-window cache
//
// Learned from usage frames rather than curated: `ModelUsage.contextWindow`
// names the real window for the model that just ran, including for models this
// repo has never heard of.
// ---------------------------------------------------------------------------

const contextWindowById = new Map<string, number>();

export function recordClaudeContextWindow(
  modelId: string | null | undefined,
  contextWindowMaxTokens: number | undefined,
): void {
  const trimmed = typeof modelId === "string" ? modelId.trim() : "";
  if (!trimmed || contextWindowMaxTokens === undefined || contextWindowMaxTokens <= 0) return;
  const capabilities = capabilitiesById.get(trimmed);
  for (const id of capabilities?.ids ?? [trimmed]) {
    contextWindowById.set(id, contextWindowMaxTokens);
  }
}

export function lookupClaudeContextWindow(modelId: string | null | undefined): number | undefined {
  const trimmed = typeof modelId === "string" ? modelId.trim() : "";
  if (!trimmed) return undefined;
  return contextWindowById.get(trimmed);
}

/** Test seam — the caches are process-wide and outlive any one session. */
export function resetClaudeModelCapabilitiesForTest(): void {
  capabilitiesById.clear();
  contextWindowById.clear();
}
