import { describe, expect, it, test } from "vitest";

import {
  resolveDraftProviderAccountOverride,
  shouldAllowEmptyDraftText,
  validateDraftSubmission,
} from "./workspace-tab-core";

const baseComposerState = {
  providerDefinitions: [{ id: "codewhale" }],
  selectedProvider: "codewhale",
  isModelLoading: false,
  effectiveModelId: "",
  availableModels: [],
};

function validate(overrides = {}) {
  return validateDraftSubmission({
    text: "hello",
    allowsEmptyAutoSubmit: false,
    composerState: baseComposerState,
    autoSubmitConfig: null,
    workspaceDirectory: "/tmp/project",
    hasClient: true,
    ...overrides,
  });
}

describe("workspace draft agent model validation", () => {
  test("allows a ready provider with no models to submit without a selected model", () => {
    expect(validate({})).toBeNull();
  });

  test("keeps waiting while model defaults are loading", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          isModelLoading: true,
        },
      }),
    ).toBe("Model defaults are still loading");
  });

  test("still requires a selected model when the provider exposes models", () => {
    expect(
      validate({
        composerState: {
          ...baseComposerState,
          availableModels: [{ id: "deepseek/deepseek-v4-pro" }],
        },
      }),
    ).toBe("No model is available for the selected provider");
  });
});

describe("workspace draft empty text readiness", () => {
  test("allows attachment-only retries after a fork draft create fails", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [{ kind: "chat_history" }],
      }),
    ).toBe(true);
  });

  test("still rejects empty drafts with no auto-submit and no attachments", () => {
    expect(
      shouldAllowEmptyDraftText({
        allowsEmptyAutoSubmit: false,
        attachments: [],
      }),
    ).toBe(false);
  });
});

describe("resolveDraftProviderAccountOverride", () => {
  it("launches on the account the new session screen picked, not the tab's default", () => {
    // The draft tab that performs the launch resolves an account of its own,
    // in a composer the user never picked in. Letting that win replaced the
    // pick with this client's default: a session started as "Steve" came up
    // signed in as "Steve 2".
    expect(
      resolveDraftProviderAccountOverride({
        autoSubmitConfig: { providerAccountId: "acct-steve" },
        composerAccountId: "acct-other",
      }),
    ).toEqual({ providerAccountId: "acct-steve" });
  });

  it("carries an explicit Default pick, which is not the same as no pick", () => {
    expect(
      resolveDraftProviderAccountOverride({
        autoSubmitConfig: { providerAccountId: null },
        composerAccountId: "acct-other",
      }),
    ).toEqual({ providerAccountId: null });
  });

  it("falls back to this composer when the launch carried no account", () => {
    expect(
      resolveDraftProviderAccountOverride({
        autoSubmitConfig: { provider: "claude" } as { providerAccountId?: string | null },
        composerAccountId: "acct-other",
      }),
    ).toEqual({ providerAccountId: "acct-other" });
  });

  it("leaves the key off when neither side named an account", () => {
    expect(
      resolveDraftProviderAccountOverride({
        autoSubmitConfig: null,
        composerAccountId: undefined,
      }),
    ).toEqual({});
  });
});
