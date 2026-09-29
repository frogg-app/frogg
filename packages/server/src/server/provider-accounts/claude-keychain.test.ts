import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { claudeKeychainServices } from "./claude-keychain.js";

describe("claudeKeychainServices", () => {
  it("suffixes the service with the first 8 hex chars of sha256(configDir)", () => {
    // Values observed from Claude Code 2.1 signing in with CLAUDE_CONFIG_DIR set.
    expect(claudeKeychainServices("/Users/paz/.claude-work")).toEqual([
      "Claude Code-credentials-168eac68",
    ]);
    expect(claudeKeychainServices("/Users/paz/.claude-perosnal")).toEqual([
      "Claude Code-credentials-556dcaac",
    ]);
  });

  it("also checks the unsuffixed service for the primary ~/.claude directory", () => {
    const services = claudeKeychainServices(path.join(os.homedir(), ".claude"));
    expect(services).toHaveLength(2);
    expect(services[1]).toBe("Claude Code-credentials");
  });
});
