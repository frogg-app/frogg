import { describe, expect, it } from "vitest";

import { applyProviderAccountEnv } from "./provider-registry.js";

describe("applyProviderAccountEnv", () => {
  it("adds the account overlay when no runtime settings exist", () => {
    expect(
      applyProviderAccountEnv({ CLAUDE_CONFIG_DIR: "/home/u/.claude-peter" }, undefined),
    ).toEqual({
      command: undefined,
      env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-peter" },
      disallowedTools: undefined,
    });
  });

  it("lets an explicit config.json provider env win over the account overlay", () => {
    const merged = applyProviderAccountEnv(
      { CLAUDE_CONFIG_DIR: "/home/u/.claude-peter" },
      { env: { CLAUDE_CONFIG_DIR: "/explicit", OTHER: "1" } },
    );

    expect(merged?.env).toEqual({ CLAUDE_CONFIG_DIR: "/explicit", OTHER: "1" });
  });

  it("keeps unrelated runtime settings untouched", () => {
    const merged = applyProviderAccountEnv(
      { CLAUDE_CONFIG_DIR: "/home/u/.claude-peter" },
      {
        command: { mode: "replace", argv: ["claude"] },
        disallowedTools: ["Bash"],
      },
    );

    expect(merged?.command).toEqual({ mode: "replace", argv: ["claude"] });
    expect(merged?.disallowedTools).toEqual(["Bash"]);
    expect(merged?.env).toEqual({ CLAUDE_CONFIG_DIR: "/home/u/.claude-peter" });
  });

  it("is a no-op without an account overlay", () => {
    const runtimeSettings = { env: { A: "1" } };
    expect(applyProviderAccountEnv(undefined, runtimeSettings)).toBe(runtimeSettings);
    expect(applyProviderAccountEnv({}, runtimeSettings)).toBe(runtimeSettings);
  });
});
