import { describe, expect, it } from "vitest";
import { buildCreateAgentOptions } from "./workspace-setup-create-agent-options";

const base = {
  text: "hello",
  attachments: [],
  encodedImages: null,
  workspaceDirectory: "/tmp/ws",
  workspaceId: "ws-1",
  provider: "claude" as const,
};

function composerState(effectiveProviderAccountId: string | null | undefined) {
  return {
    modeOptions: [{ id: "default" }],
    selectedMode: "default",
    effectiveModelId: "opus",
    effectiveThinkingOptionId: null,
    effectiveProviderAccountId,
  };
}

describe("buildCreateAgentOptions", () => {
  it("sends the picked account so the new session launches on it", () => {
    const options = buildCreateAgentOptions({ ...base, composerState: composerState("acct-2") });
    expect(options.providerAccountId).toBe("acct-2");
  });

  it("sends null for the explicit Default pick", () => {
    const options = buildCreateAgentOptions({ ...base, composerState: composerState(null) });
    expect(options.providerAccountId).toBeNull();
  });

  it("omits the key when the user never picked", () => {
    const options = buildCreateAgentOptions({ ...base, composerState: composerState(undefined) });
    expect("providerAccountId" in options).toBe(false);
  });
});
