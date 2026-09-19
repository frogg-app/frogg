import { describe, expect, it } from "vitest";

import {
  resolveAgentProviderAccountEnv,
  resolveProviderAccountConfigDir,
} from "./provider-account-env.js";
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
    const foreign: ProviderAccount = {
      ...PETER,
      id: "acct-codex",
      provider: "codex",
    };
    const store = createStore({
      accounts: [foreign],
      activeAccountId: "acct-work",
    });
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

describe("resolveAgentProviderAccountEnv in home mode", () => {
  const GEM: ProviderAccount = {
    id: "acct-gem",
    provider: "gemini",
    name: "second",
    // In home mode the account dir is the synthetic home; gemini reads
    // <configDir>/.gemini inside it.
    configDir: "/home/u/.gemini-second",
    linkedFolders: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  // The shipped gemini entry is opt-in; a store enables it from config.json.
  const geminiCapability = {
    ...findProviderAccountCapability("gemini")!,
    enabled: true,
  };
  const claudeCapability = findProviderAccountCapability("claude");

  const capabilities: Record<string, typeof geminiCapability | undefined> = {
    gemini: geminiCapability,
    ...(claudeCapability ? { claude: claudeCapability } : {}),
  };

  const store = {
    getCapability: (provider: string) => capabilities[provider],
    activeAccountIds: () => ({ gemini: GEM.id }),
    findAccount: (id: string) => (id === GEM.id ? GEM : undefined),
    primaryConfigDir: (provider: string) =>
      provider === "gemini" ? "/home/u/.gemini" : "/home/u/.claude",
  };

  it("points HOME at the account directory for the named account", () => {
    expect(resolveAgentProviderAccountEnv(store, "gemini", "acct-gem")).toEqual({
      env: { HOME: "/home/u/.gemini-second" },
    });
  });

  it("uses the daemon-wide active account when the agent names none", () => {
    expect(resolveAgentProviderAccountEnv(store, "gemini", undefined)).toEqual({
      env: { HOME: "/home/u/.gemini-second" },
    });
  });

  it("never sets HOME to the primary config dir for the default pick", () => {
    // ~/.gemini is a directory in the real home, not a home: the default
    // account simply inherits the daemon's real HOME.
    expect(resolveAgentProviderAccountEnv(store, "gemini", null)).toEqual({
      env: {},
    });
  });

  it("does not leak HOME into another provider's overlay", () => {
    expect(resolveAgentProviderAccountEnv(store, "claude", undefined)).toEqual({
      env: {},
    });
    expect(resolveAgentProviderAccountEnv(store, "claude", null)).toEqual({
      env: { CLAUDE_CONFIG_DIR: "/home/u/.claude" },
    });
    // An account id from another provider never crosses over.
    expect(resolveAgentProviderAccountEnv(store, "claude", "acct-gem")).toEqual({
      env: {},
      unknownAccountId: "acct-gem",
    });
  });
});

// The usage popover reads credentials straight from a config dir, so it must
// land on exactly the directory the agent's provider process was launched with.
describe("resolveProviderAccountConfigDir", () => {
  it("follows the daemon-wide active account when the agent names none", () => {
    const store = createStore({ activeAccountId: "acct-work" });
    expect(resolveProviderAccountConfigDir(store, "claude", undefined)).toBe(
      "/home/u/.claude-work",
    );
  });

  it("pins the primary config dir for the explicit Default pick, even with an active account", () => {
    const store = createStore({ activeAccountId: "acct-work" });
    expect(resolveProviderAccountConfigDir(store, "claude", null)).toBe("/home/u/.claude");
  });

  it("uses the agent's own account over the active one", () => {
    const store = createStore({ activeAccountId: "acct-work" });
    expect(resolveProviderAccountConfigDir(store, "claude", "acct-peter")).toBe(
      "/home/u/.claude-peter",
    );
  });

  it("uses the primary dir when nothing is active and the agent names none", () => {
    expect(resolveProviderAccountConfigDir(createStore({}), "claude", undefined)).toBe(
      "/home/u/.claude",
    );
  });

  it("falls back like a launch would when the account was deleted", () => {
    const store = createStore({ activeAccountId: "acct-work" });
    expect(resolveProviderAccountConfigDir(store, "claude", "acct-gone")).toBe(
      "/home/u/.claude-work",
    );
  });

  it("leaves the fetcher on its default when accounts are disabled", () => {
    const store = createStore({ activeAccountId: "acct-work", enabled: false });
    expect(resolveProviderAccountConfigDir(store, "claude", "acct-peter")).toBeUndefined();
  });
});
