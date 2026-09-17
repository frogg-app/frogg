import { describe, expect, it } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { ProviderSnapshotManager } from "./provider-snapshot-manager.js";

function createManager(options: {
  overlay: { env: Record<string, string>; unknownAccountId?: string };
  runtimeEnv?: Record<string, string>;
  overrideEnv?: Record<string, string>;
}): ProviderSnapshotManager {
  return new ProviderSnapshotManager({
    logger: createTestLogger(),
    ...(options.runtimeEnv ? { runtimeSettings: { claude: { env: options.runtimeEnv } } } : {}),
    ...(options.overrideEnv ? { providerOverrides: { claude: { env: options.overrideEnv } } } : {}),
    providerAccountEnvForAgent: () => options.overlay,
  });
}

describe("ProviderSnapshotManager.resolveAgentProviderAccountEnv", () => {
  it("returns the account overlay when no explicit provider env is configured", () => {
    const manager = createManager({ overlay: { env: { CLAUDE_CONFIG_DIR: "/acct" } } });
    try {
      expect(manager.resolveAgentProviderAccountEnv("claude", "acct-peter")).toEqual({
        env: { CLAUDE_CONFIG_DIR: "/acct" },
      });
    } finally {
      manager.destroy();
    }
  });

  it("drops keys an explicit agents.providers.<id>.env already pins", () => {
    const manager = createManager({
      overlay: { env: { CLAUDE_CONFIG_DIR: "/acct" } },
      runtimeEnv: { CLAUDE_CONFIG_DIR: "/explicit" },
    });
    try {
      expect(manager.resolveAgentProviderAccountEnv("claude", "acct-peter")).toEqual({ env: {} });
    } finally {
      manager.destroy();
    }
  });

  it("drops keys a config.json provider override pins", () => {
    const manager = createManager({
      overlay: { env: { CLAUDE_CONFIG_DIR: "/acct", OTHER: "1" } },
      overrideEnv: { CLAUDE_CONFIG_DIR: "/explicit" },
    });
    try {
      expect(manager.resolveAgentProviderAccountEnv("claude", "acct-peter")).toEqual({
        env: { OTHER: "1" },
      });
    } finally {
      manager.destroy();
    }
  });

  it("carries the deleted-account signal through to the caller", () => {
    const manager = createManager({
      overlay: { env: { CLAUDE_CONFIG_DIR: "/active" }, unknownAccountId: "acct-gone" },
    });
    try {
      expect(manager.resolveAgentProviderAccountEnv("claude", "acct-gone")).toEqual({
        env: { CLAUDE_CONFIG_DIR: "/active" },
        unknownAccountId: "acct-gone",
      });
    } finally {
      manager.destroy();
    }
  });

  it("is empty when the daemon wires no account resolver", () => {
    const manager = new ProviderSnapshotManager({ logger: createTestLogger() });
    try {
      expect(manager.resolveAgentProviderAccountEnv("claude", "acct-peter")).toEqual({ env: {} });
    } finally {
      manager.destroy();
    }
  });
});
