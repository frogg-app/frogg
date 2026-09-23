/**
 * Test helpers for the generated Claude model catalog.
 *
 * Production reads the catalog off the installed CLI, so tests have to say what
 * that CLI reported. `seedClaudeModelCatalog` stands in for one such report and
 * fills the same process-wide caches a real fetch would.
 */

import type { ModelInfo } from "@anthropic-ai/claude-agent-sdk";

import {
  recordClaudeModelCapabilities,
  resetClaudeModelCapabilitiesForTest,
} from "./model-catalog.js";

export function claudeModelInfo(overrides: Partial<ModelInfo> & { value: string }): ModelInfo {
  return {
    displayName: overrides.value,
    description: `${overrides.value} description`,
    ...overrides,
  };
}

/** A small stand-in catalog covering the capability combinations that matter. */
export const SAMPLE_CLAUDE_MODELS: ModelInfo[] = [
  claudeModelInfo({
    value: "claude-opus-5",
    displayName: "Opus 5",
    description: "Opus 5 · Latest release",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
  }),
  claudeModelInfo({
    value: "claude-opus-4-8[1m]",
    displayName: "Opus 4.8 1M",
    description: "Opus 4.8 with 1M context window",
    resolvedModel: "claude-opus-4-8",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
  }),
  claudeModelInfo({
    value: "claude-fable-5",
    displayName: "Fable 5",
    description: "Fable 5 · Previous release",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  }),
  claudeModelInfo({
    value: "claude-sonnet-5",
    displayName: "Sonnet 5",
    description: "Sonnet 5 · Best for everyday tasks",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high", "max"],
    supportsAdaptiveThinking: true,
  }),
  claudeModelInfo({
    value: "claude-haiku-4-5",
    displayName: "Haiku 4.5",
    description: "Haiku 4.5 · Fastest for quick answers",
    supportsEffort: false,
  }),
];

export function seedClaudeModelCatalog(models: ModelInfo[] = SAMPLE_CLAUDE_MODELS): ModelInfo[] {
  resetClaudeModelCapabilitiesForTest();
  recordClaudeModelCapabilities(models);
  return models;
}
