import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentModelDefinition } from "../../agent-sdk-types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import { parseClaudeCodeVersion } from "./claude-code-version.js";
import { claudeModelSupportsFastMode } from "./feature-definitions.js";
import {
  CLAUDE_DISABLED_THINKING_OPTION_ID,
  CLAUDE_ULTRACODE_THINKING_OPTION_ID,
  resolveClaudeDisabledThinkingForModel,
} from "./model-catalog.js";
import { normalizeClaudeRuntimeModelId, resolveObservedClaudeModelId } from "./models.js";
import { SAMPLE_CLAUDE_MODELS, seedClaudeModelCatalog } from "./test-utils.js";
import type { ClaudeQueryFactory } from "./query.js";

const createdClaudeConfigDirs: string[] = [];

beforeEach(() => {
  seedClaudeModelCatalog();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    createdClaudeConfigDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  createdClaudeConfigDirs.length = 0;
});

async function createClaudeConfigDir(settings: unknown): Promise<string> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "frogg-claude-models-"));
  createdClaudeConfigDirs.push(configDir);
  await fs.writeFile(path.join(configDir, "settings.json"), JSON.stringify(settings, null, 2));
  return configDir;
}

async function createClaudeConfigDirWithRawSettings(settings: string): Promise<string> {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "frogg-claude-models-"));
  createdClaudeConfigDirs.push(configDir);
  await fs.writeFile(path.join(configDir, "settings.json"), settings);
  return configDir;
}

function createCatalogClient(): ClaudeAgentClient {
  const queryFactory = vi.fn(() => ({
    supportedModels: vi.fn(async () => SAMPLE_CLAUDE_MODELS),
    close: vi.fn(),
    return: vi.fn(async () => undefined),
  })) as unknown as ClaudeQueryFactory;
  return new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude/bin",
    queryFactory,
  });
}

function fetchModels(client: ClaudeAgentClient) {
  return client.fetchCatalog({ scope: "workspace", cwd: os.tmpdir(), force: true });
}

const REPORTED_MODEL_IDS = SAMPLE_CLAUDE_MODELS.map((model) => model.value);

const idsOf = (models: AgentModelDefinition[]) => models.map((model) => model.id);

describe("the generated Claude catalog", () => {
  it("offers exactly what the CLI reported, and nothing curated here", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "frogg-claude-models-"));
    createdClaudeConfigDirs.push(configDir);
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);

    const { models } = await fetchModels(createCatalogClient());

    expect(idsOf(models)).toEqual(REPORTED_MODEL_IDS);
  });

  it("derives thinking options from the effort levels the CLI reported", async () => {
    const configDir = await fs.mkdtemp(path.join(os.tmpdir(), "frogg-claude-models-"));
    createdClaudeConfigDirs.push(configDir);
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);

    const { models } = await fetchModels(createCatalogClient());
    const thinkingIds = (modelId: string) =>
      models.find((model) => model.id === modelId)?.thinkingOptions?.map(({ id }) => id);

    // Adaptive thinking is what "Off" means, and xhigh is what Ultra Code rides on.
    expect(thinkingIds("claude-opus-5")).toEqual([
      CLAUDE_DISABLED_THINKING_OPTION_ID,
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      CLAUDE_ULTRACODE_THINKING_OPTION_ID,
    ]);
    // Fable 5 reports xhigh without adaptive thinking: Ultra Code, no Off.
    expect(thinkingIds("claude-fable-5")).not.toContain(CLAUDE_DISABLED_THINKING_OPTION_ID);
    expect(thinkingIds("claude-fable-5")).toContain(CLAUDE_ULTRACODE_THINKING_OPTION_ID);
    // Haiku reports no effort support, so it gets no thinking control at all.
    expect(thinkingIds("claude-haiku-4-5")).toBeUndefined();
  });

  it("appends concrete models from Claude settings.json", async () => {
    const configDir = await createClaudeConfigDir({
      model: "us.anthropic.claude-opus-4-7[1m]",
      env: {
        ANTHROPIC_MODEL: "openrouter/anthropic/claude-sonnet-4.5",
        ANTHROPIC_SMALL_FAST_MODEL: "ollama/qwen3-coder",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "bedrock-opus-from-env",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5",
      },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);

    const { models } = await fetchModels(createCatalogClient());

    expect(models.slice(REPORTED_MODEL_IDS.length)).toEqual([
      {
        provider: "claude",
        id: "us.anthropic.claude-opus-4-7[1m]",
        label: "us.anthropic.claude-opus-4-7[1m]",
        description: "From Claude settings.json model",
      },
      {
        provider: "claude",
        id: "openrouter/anthropic/claude-sonnet-4.5",
        label: "openrouter/anthropic/claude-sonnet-4.5",
        description: "From Claude settings.json env.ANTHROPIC_MODEL",
      },
      {
        provider: "claude",
        id: "ollama/qwen3-coder",
        label: "ollama/qwen3-coder",
        description: "From Claude settings.json env.ANTHROPIC_SMALL_FAST_MODEL",
      },
      {
        provider: "claude",
        id: "bedrock-opus-from-env",
        label: "bedrock-opus-from-env",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_OPUS_MODEL",
      },
      {
        provider: "claude",
        id: "glm-5.1",
        label: "glm-5.1",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_SONNET_MODEL",
      },
      {
        provider: "claude",
        id: "glm-5",
        label: "glm-5",
        description: "From Claude settings.json env.ANTHROPIC_DEFAULT_HAIKU_MODEL",
      },
    ]);
  });

  it("keeps the reported catalog when settings.json is missing or malformed", async () => {
    const missingDir = await fs.mkdtemp(path.join(os.tmpdir(), "frogg-claude-models-"));
    createdClaudeConfigDirs.push(missingDir);
    vi.stubEnv("CLAUDE_CONFIG_DIR", missingDir);
    const missing = await fetchModels(createCatalogClient());
    expect(idsOf(missing.models)).toEqual(REPORTED_MODEL_IDS);

    vi.stubEnv("CLAUDE_CONFIG_DIR", await createClaudeConfigDirWithRawSettings("{ not json"));
    const malformed = await fetchModels(createCatalogClient());
    expect(idsOf(malformed.models)).toEqual(REPORTED_MODEL_IDS);
  });

  it("does not repeat a settings model the CLI already reported", async () => {
    const configDir = await createClaudeConfigDir({
      model: "claude-opus-5",
      env: { ANTHROPIC_MODEL: "claude-opus-4-8" },
    });
    vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);

    const { models } = await fetchModels(createCatalogClient());

    // `claude-opus-4-8` is the wire id behind the 1M row, so it is an alias of
    // a reported model rather than a model of its own.
    expect(idsOf(models)).toEqual(REPORTED_MODEL_IDS);
  });

  it("ignores empty env blocks and unexpected settings shapes", async () => {
    for (const settings of [{ env: {} }, { env: 42 }, ["not", "an", "object"]]) {
      const configDir = await createClaudeConfigDir(settings);
      vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
      const { models } = await fetchModels(createCatalogClient());
      expect(idsOf(models)).toEqual(REPORTED_MODEL_IDS);
    }
  });
});

describe("normalizeClaudeRuntimeModelId", () => {
  it("returns the catalog's own id for an exact match", () => {
    expect(normalizeClaudeRuntimeModelId("claude-opus-5")).toBe("claude-opus-5");
    expect(normalizeClaudeRuntimeModelId("claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("normalizes a dated id to the model it dates", () => {
    expect(normalizeClaudeRuntimeModelId("claude-opus-5-20260724")).toBe("claude-opus-5");
  });

  it("recognizes a reported model behind a gateway prefix", () => {
    expect(normalizeClaudeRuntimeModelId("us.anthropic.claude-sonnet-5")).toBe("claude-sonnet-5");
  });

  it("resolves an id to the row that declares it as its wire id", () => {
    expect(normalizeClaudeRuntimeModelId("claude-opus-4-8")).toBe("claude-opus-4-8[1m]");
  });

  it("returns null for empty and unrecognized values", () => {
    expect(normalizeClaudeRuntimeModelId(null)).toBeNull();
    expect(normalizeClaudeRuntimeModelId(undefined)).toBeNull();
    expect(normalizeClaudeRuntimeModelId("  ")).toBeNull();
    expect(normalizeClaudeRuntimeModelId("glm-5.1")).toBeNull();
  });
});

describe("resolveObservedClaudeModelId", () => {
  it("keeps an unrecognized compatible-provider model visible", () => {
    expect(resolveObservedClaudeModelId("glm-5.1")).toBe("glm-5.1");
  });

  it("drops placeholders and empty values", () => {
    expect(resolveObservedClaudeModelId("<synthetic>")).toBeNull();
    expect(resolveObservedClaudeModelId("   ")).toBeNull();
  });
});

describe("claudeModelSupportsFastMode", () => {
  it("follows what the CLI reported, per model", () => {
    expect(claudeModelSupportsFastMode("claude-opus-5")).toBe(true);
    expect(claudeModelSupportsFastMode("claude-opus-5-20260724")).toBe(true);
    expect(claudeModelSupportsFastMode("claude-sonnet-5")).toBe(false);
  });

  it("stays strict to first-party ids", () => {
    // A gateway endpoint that proxies a model need not support what the
    // first-party one does, so it does not inherit the capability.
    expect(claudeModelSupportsFastMode("openrouter/anthropic/claude-opus-5")).toBe(false);
    expect(claudeModelSupportsFastMode("glm-5.1")).toBe(false);
  });
});

describe("resolveClaudeDisabledThinkingForModel", () => {
  it("allows Off only where the CLI reported adaptive thinking", () => {
    expect(resolveClaudeDisabledThinkingForModel("claude-opus-5").supported).toBe(true);
    expect(resolveClaudeDisabledThinkingForModel("claude-fable-5").supported).toBe(false);
  });

  it("falls back to the default effort for a model that has efforts but not Off", () => {
    expect(resolveClaudeDisabledThinkingForModel("claude-fable-5")).toEqual({
      supported: false,
      fallbackThinkingOptionId: "high",
    });
  });

  it("refuses Off for a model outside a catalog that has been read", () => {
    expect(resolveClaudeDisabledThinkingForModel("glm-5.1").supported).toBe(false);
  });
});

describe("parseClaudeCodeVersion", () => {
  it("prefers the Claude Code version over a wrapper banner", () => {
    expect(parseClaudeCodeVersion("wrapper 1.0.0\n2.1.219 (Claude Code)")).toEqual([2, 1, 219]);
  });
});
