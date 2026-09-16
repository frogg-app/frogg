import { describe, expect, it } from "vitest";
import {
  buildClaudeAccountProvider,
  CLAUDE_ACCOUNT_CONTENT,
  sanitizeClaudeAccountName,
  validateClaudeAccountLabel,
} from "./claude-account";

describe("Claude account settings", () => {
  it("sanitizes labels and validates required labels", () => {
    expect(sanitizeClaudeAccountName("  Team / Primary...  ")).toBe("Team--Primary");
    expect(sanitizeClaudeAccountName("../../")).toBe("account");
    expect(sanitizeClaudeAccountName("日本語 アカウント")).toBe("日本語-アカウント");
    expect(validateClaudeAccountLabel("  ")).toBe("required");
    expect(validateClaudeAccountLabel("Primary")).toBeNull();
  });
  it("selects every shareable content directory by default", () => {
    expect(CLAUDE_ACCOUNT_CONTENT).toEqual([
      "commands",
      "hooks",
      "plans",
      "plugins",
      "projects",
      "skills",
      "todos",
    ]);
  });
  it("adds a collision-resistant suffix to the provider and config directory", () => {
    const generated = buildClaudeAccountProvider("Work", [], {
      "claude-account-work": { extends: "claude" },
      "claude-account-work-2": { extends: "claude" },
    });
    expect(generated.id).toBe("claude-account-work-3");
    expect(generated.provider.params?.claudeAccount?.configDir).toBe("~/.claude-account-work-3");
  });
  it("generates the daemon provider config with selected shared content", () => {
    expect(buildClaudeAccountProvider(" Personal ", ["commands", "skills"])).toEqual({
      id: "claude-account-personal",
      provider: {
        extends: "claude",
        label: "Personal",
        params: {
          claudeAccount: {
            configDir: "~/.claude-account-personal",
            sharedContent: ["commands", "skills"],
          },
        },
      },
    });
  });
});
