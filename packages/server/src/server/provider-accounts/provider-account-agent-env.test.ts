import { describe, expect, it } from "vitest";

import { resolveAgentProviderAccountEnv } from "./provider-account-env.js";
import type { ProviderAccount } from "@frogg/protocol/provider-accounts";
import { findProviderAccountCapability } from "@frogg/protocol/provider-accounts";

const PETER: ProviderAccount = {
  id: "acct-peter",
  provider: "claude",
  name: "peter",
  configDir: "/home/u/.claude-peter",
  linkedFolders: [],
  createdAt: "2026-01-01T00:00:00.000Z",
};

const WORK: ProviderAccount = {
  ...PETER,
  id: "acct-work",
  name: "work",
  configDir: "/home/u/.claude-work",
};

function createStore(options: {
  activeAccountId?: string;
  accounts?: ProviderAccount[];
  enabled?: boolean;
}) {
  const accounts = options.accounts ?? [PETER, WORK];
  const capability = findProviderAccountCapability("claude");
  return {
    getCapability: (provider: string) =>
      provider === "claude" && options.enabled !== false ? capability : undefined,
    activeAccountIds: () => (options.activeAccountId ? { claude: options.activeAccountId } : {}),
    findAccount: (id: string) => accounts.find((account) => account.id === id),
    primaryConfigDir: (provider: string) => (provider === "claude" ? "/home/u/.claude" : undefined),
  };
}

describe("resolveAgentProviderAccountEnv", () => {
  it("uses the agent's own account over the daemon-wide active account", () => {
    const store = createStore({ activeAccountId: "acct-work" });
    expect(resolveAgentProviderAccountEnv(store, "claude", "acct-peter")).toEqual({
      env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-peter" },
    });
  });

  it("falls back to the daemon-wide active account when the agent names none", () => {
    const store = createStore({ activeAccountId: "acct-work" });
    expect(resolveAgentProviderAccountEnv(store, "claude", undefined)).toEqual({
      env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-work" },
    });
  });

  it("returns an empty overlay when nothing is active and the agent names none", () => {
    expect(resolveAgentProviderAccountEnv(createStore({}), "claude", undefined)).toEqual({
      env: {},
    });
  });

  it("pins the provider's primary config dir for the explicit default pick", () => {
    const store = createStore({ activeAccountId: "acct-work" });
    expect(resolveAgentProviderAccountEnv(store, "claude", null)).toEqual({
      env: { CLAUDE_CONFIG_DIR: "/home/u/.claude" },
    });
  });

  it("falls back to default resolution and reports a deleted account id", () => {
    const store = createStore({ activeAccountId: "acct-work" });
    expect(resolveAgentProviderAccountEnv(store, "claude", "acct-deleted")).toEqual({
      env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-work" },
      unknownAccountId: "acct-deleted",
    });
  });

  it("falls back to no overlay when a deleted account has no active account behind it", () => {
    expect(resolveAgentProviderAccountEnv(createStore({}), "claude", "acct-deleted")).toEqual({
      env: {},
      unknownAccountId: "acct-deleted",
    });
  });

  it("ignores an account id that belongs to a different provider", () => {
    const foreign: ProviderAccount = { ...PETER, id: "acct-codex", provider: "codex" };
    const store = createStore({ accounts: [foreign], activeAccountId: "acct-work" });
    expect(resolveAgentProviderAccountEnv(store, "claude", "acct-codex")).toEqual({
      env: {},
      unknownAccountId: "acct-codex",
    });
  });

  it("is empty for a provider whose accounts capability is disabled", () => {
    const store = createStore({ enabled: false, activeAccountId: "acct-work" });
    expect(resolveAgentProviderAccountEnv(store, "claude", "acct-peter")).toEqual({ env: {} });
  });
});
