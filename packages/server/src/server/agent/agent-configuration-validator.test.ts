import { describe, expect, it } from "vitest";

import {
  isModelAllowed,
  validateAgentConfigurationAgainstProvider,
} from "./agent-configuration-validator.js";
import type { ProviderSnapshotEntry } from "./agent-sdk-types.js";

const provider: ProviderSnapshotEntry = {
  provider: "claude",
  status: "ready",
  enabled: true,
  models: [
    { provider: "claude", id: "opus", label: "Opus", isDefault: true },
    { provider: "claude", id: "sonnet", label: "Sonnet", aliases: ["sonnet-latest"] },
    { provider: "claude", id: "haiku", label: "Haiku" },
  ],
  modes: [{ id: "default", label: "Default" }],
} as ProviderSnapshotEntry;

const passThroughOptions = (options: undefined) => options;

function validate(
  input: Parameters<typeof validateAgentConfigurationAgainstProvider>[0]["input"],
  allowedModels?: readonly string[],
) {
  return validateAgentConfigurationAgainstProvider({
    input,
    provider,
    validateOptions: passThroughOptions as never,
    allowedModels,
  });
}

describe("per-account allowedModels enforcement", () => {
  it("allows every provider model when the account places no restriction", () => {
    expect(validate({ provider: "claude", model: "haiku" })).toEqual([]);
    expect(validate({ provider: "claude", model: "haiku" }, undefined)).toEqual([]);
  });

  it("allows a model inside the account's list", () => {
    expect(validate({ provider: "claude", model: "sonnet" }, ["opus", "sonnet"])).toEqual([]);
  });

  it("rejects a provider model the account is not permitted to use", () => {
    expect(validate({ provider: "claude", model: "haiku" }, ["opus", "sonnet"])).toEqual([
      {
        path: ["model"],
        message: "Model 'haiku' is not permitted for the selected account on provider 'claude'",
      },
    ]);
  });

  it("still reports an unknown model as unavailable rather than unpermitted", () => {
    expect(validate({ provider: "claude", model: "nonesuch" }, ["opus"])).toEqual([
      { path: ["model"], message: "Model 'nonesuch' is not available for provider 'claude'" },
    ]);
  });

  it("rejects everything when the account permits no models", () => {
    expect(validate({ provider: "claude", model: "opus" }, [])).toEqual([
      {
        path: ["model"],
        message: "Model 'opus' is not permitted for the selected account on provider 'claude'",
      },
    ]);
  });

  it("reports an empty allow-list even when no model was requested", () => {
    expect(validate({ provider: "claude" }, [])).toEqual([
      { path: ["model"], message: "The selected account on provider 'claude' permits no models" },
    ]);
  });

  it("matches a model by alias so an allow-list written with the visible name works", () => {
    expect(validate({ provider: "claude", model: "sonnet" }, ["sonnet-latest"])).toEqual([]);
    expect(isModelAllowed({ id: "sonnet", aliases: ["sonnet-latest"] }, ["sonnet-latest"])).toBe(
      true,
    );
    expect(isModelAllowed({ id: "sonnet" }, ["opus"])).toBe(false);
  });

  it("falls back to a permitted default when the restriction hides the provider default", () => {
    // `opus` is the provider default but is not permitted; validation must not
    // fail for an unspecified model while a permitted model remains.
    expect(validate({ provider: "claude" }, ["haiku"])).toEqual([]);
  });
});
