import { describe, expect, it } from "vitest";
import { buildWorkspaceDraftAgentConfig } from "./workspace-draft-agent-config";

describe("workspace-draft-agent-config", () => {
  it("builds chat-only config for workspace draft agents", () => {
    expect(
      buildWorkspaceDraftAgentConfig({
        provider: "codex",
        cwd: "/tmp/project",
        modeId: "auto",
        model: "gpt-5.4",
        thinkingOptionId: "high",
      }),
    ).toEqual({
      provider: "codex",
      cwd: "/tmp/project",
      modeId: "auto",
      model: "gpt-5.4",
      thinkingOptionId: "high",
    });
  });

  it("omits providerAccountId when the user never picked an account", () => {
    const config = buildWorkspaceDraftAgentConfig({ provider: "claude", cwd: "/tmp/project" });
    expect("providerAccountId" in config).toBe(false);
  });

  it("omits providerAccountId when it is passed as undefined", () => {
    const config = buildWorkspaceDraftAgentConfig({
      provider: "claude",
      cwd: "/tmp/project",
      providerAccountId: undefined,
    });
    expect("providerAccountId" in config).toBe(false);
  });

  it("sends an explicit null for the Default pick rather than dropping the key", () => {
    const config = buildWorkspaceDraftAgentConfig({
      provider: "claude",
      cwd: "/tmp/project",
      providerAccountId: null,
    });
    expect("providerAccountId" in config).toBe(true);
    expect(config.providerAccountId).toBeNull();
  });

  it("sends a named account id", () => {
    expect(
      buildWorkspaceDraftAgentConfig({
        provider: "claude",
        cwd: "/tmp/project",
        providerAccountId: "acct-steve",
      }).providerAccountId,
    ).toBe("acct-steve");
  });
});
