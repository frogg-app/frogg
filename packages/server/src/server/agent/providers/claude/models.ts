import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Logger } from "pino";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import type { ProviderRuntimeSettings } from "../../provider-launch-config.js";
import {
  buildClaudeModelDefinitions,
  buildClaudeThinkingOptions,
  getClaudeCustomModelThinkingOptions,
  lookupClaudeModelByAnyId,
  lookupClaudeModelCapabilities,
  lookupClaudeModelLabel,
} from "./model-catalog.js";
import {
  fetchClaudeSupportedModels,
  type FetchClaudeSupportedModelsOptions,
} from "./model-catalog-fetch.js";
import type { ClaudeQueryFactory } from "./query.js";

const CLAUDE_SETTINGS_MODEL_ENV_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
] as const;

export interface FetchClaudeModelsOptions {
  logger: Logger;
  configDir?: string;
  binaryPath?: string;
  runtimeSettings?: ProviderRuntimeSettings;
  launchEnv?: Record<string, string>;
  queryFactory?: ClaudeQueryFactory;
  signal?: AbortSignal;
  /** Test seam — defaults to a real short-lived control-plane query. */
  fetchSupportedModels?: (
    options: FetchClaudeSupportedModelsOptions,
  ) => Promise<Awaited<ReturnType<typeof fetchClaudeSupportedModels>>>;
}

/**
 * The models this host can run: whatever the installed Claude Code reports,
 * plus any model named in the user's `settings.json` that the CLI did not list.
 */
export async function fetchClaudeModels(
  options: FetchClaudeModelsOptions,
): Promise<AgentModelDefinition[]> {
  const fetchSupported = options.fetchSupportedModels ?? fetchClaudeSupportedModels;
  const reported = await fetchSupported({
    logger: options.logger,
    ...(options.binaryPath ? { binaryPath: options.binaryPath } : {}),
    ...(options.runtimeSettings ? { runtimeSettings: options.runtimeSettings } : {}),
    ...(options.launchEnv ? { launchEnv: options.launchEnv } : {}),
    ...(options.queryFactory ? { queryFactory: options.queryFactory } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const models = buildClaudeModelDefinitions(reported);

  for (const settingsModel of await readClaudeSettingsModels(options.logger, options.configDir)) {
    const existingIndex = models.findIndex(
      (candidate) =>
        candidate.id === settingsModel.id || candidate.aliases?.includes(settingsModel.id),
    );
    if (existingIndex === -1) {
      models.push(settingsModel);
      continue;
    }
    // A configured model the CLI also lists keeps the CLI's own row; it only
    // needs to become selectable if the catalog had hidden it.
    const existing = models[existingIndex];
    if (existing?.isSelectable === false) {
      models[existingIndex] = { ...existing, isSelectable: true };
    }
  }

  return models;
}

/**
 * Fill in the thinking options a configured model did not state for itself.
 *
 * A model the CLI described gets that model's own options; anything else gets
 * the generic set, since a custom or gateway model's efforts are unknown.
 */
export function resolveConfiguredClaudeModel(model: AgentModelDefinition): AgentModelDefinition {
  if (model.thinkingOptions !== undefined) return model;
  const capabilities = lookupClaudeModelCapabilities(model.id);
  const reported = capabilities
    ? buildClaudeThinkingOptions(capabilities.effortLevels, capabilities.supportsThinkingDisabled)
    : undefined;
  return { ...model, thinkingOptions: reported ?? getClaudeCustomModelThinkingOptions() };
}

async function readClaudeSettingsModels(
  logger: Logger,
  configDir?: string,
): Promise<AgentModelDefinition[]> {
  const settingsPath = path.join(resolveClaudeConfigDir(configDir), "settings.json");

  let parsed: unknown;
  try {
    const rawSettings = await fs.readFile(settingsPath, "utf8");
    parsed = JSON.parse(rawSettings);
  } catch (error) {
    logger.debug({ err: error, settingsPath }, "Failed to read Claude settings models");
    return [];
  }

  if (!isRecord(parsed)) {
    logger.debug({ settingsPath }, "Claude settings.json is not an object");
    return [];
  }

  const models: AgentModelDefinition[] = [];
  addSettingsModel(models, parsed.model, "model");

  const env = parsed.env;
  if (env === undefined) {
    return models;
  }
  if (!isRecord(env)) {
    logger.debug({ settingsPath }, "Claude settings.json env is not an object");
    return models;
  }

  for (const envKey of CLAUDE_SETTINGS_MODEL_ENV_KEYS) {
    addSettingsModel(models, env[envKey], `env.${envKey}`);
  }

  return models;
}

function resolveClaudeConfigDir(configDir?: string): string {
  return configDir ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
}

function addSettingsModel(
  models: AgentModelDefinition[],
  value: unknown,
  settingsKey: string,
): void {
  if (typeof value !== "string") {
    return;
  }

  const id = value.trim();
  if (id.length === 0 || models.some((model) => model.id === id)) {
    return;
  }

  models.push({
    provider: "claude",
    id,
    label: id,
    description: `From Claude settings.json ${settingsKey}`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Placeholder model values Claude Code writes on frames with no real inference behind them.
 * These are not models and must never be displayed.
 */
const CLAUDE_PLACEHOLDER_MODEL_IDS = new Set(["<synthetic>"]);

/**
 * Resolve a model id observed on a Claude assistant frame, for display.
 *
 * Collapses to the catalog's own id when the observed string names a model the
 * CLI reported — a dated alias and a gateway prefix are the same model — and
 * otherwise keeps the raw string. The fallback matters: Claude Code is an
 * Anthropic-compatible client, so subagents routinely report models that are
 * not Anthropic's (Z.AI GLM ids via `ANTHROPIC_BASE_URL`, among them), and
 * dropping those would blank the model for exactly those users.
 *
 * Returns null for placeholders and empty values, meaning "not observed".
 */
export function resolveObservedClaudeModelId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || CLAUDE_PLACEHOLDER_MODEL_IDS.has(trimmed)) {
    return null;
  }
  return normalizeClaudeRuntimeModelId(trimmed) ?? trimmed;
}

/**
 * Normalize a runtime model string (from an SDK init message, or a provider
 * prefixed wire id) to the id the catalog knows it by.
 */
export function normalizeClaudeRuntimeModelId(value: string | null | undefined): string | null {
  const capabilities = lookupClaudeModelByAnyId(value);
  return capabilities?.ids[0] ?? null;
}

/** The catalog's display label for a model id, falling back to the id itself. */
export function resolveClaudeModelLabel(modelId: string): string {
  return lookupClaudeModelLabel(modelId) ?? modelId;
}
