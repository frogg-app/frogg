import { describe, expect, it } from "vitest";

import {
  findProviderAccountCapability,
  PROVIDER_ACCOUNT_CAPABILITIES,
  ProviderAccountStateSchema,
  toProviderAccountSlug,
} from "./provider-accounts.js";

describe("toProviderAccountSlug", () => {
  it("accepts lowercase slugs", () => {
    expect(toProviderAccountSlug("peter")).toBe("peter");
    expect(toProviderAccountSlug("work-account-2")).toBe("work-account-2");
  });

  it("lowercases and trims", () => {
    expect(toProviderAccountSlug("  Jason  ")).toBe("jason");
  });

  it("rejects empty, spaced, and punctuated names", () => {
    expect(toProviderAccountSlug("")).toBeNull();
    expect(toProviderAccountSlug("   ")).toBeNull();
    expect(toProviderAccountSlug("two words")).toBeNull();
    expect(toProviderAccountSlug("trailing-")).toBeNull();
    expect(toProviderAccountSlug("-leading")).toBeNull();
    expect(toProviderAccountSlug("double--hyphen")).toBeNull();
    expect(toProviderAccountSlug("dots.here")).toBeNull();
    expect(toProviderAccountSlug("../escape")).toBeNull();
    expect(toProviderAccountSlug("a".repeat(65))).toBeNull();
  });
});

describe("PROVIDER_ACCOUNT_CAPABILITIES", () => {
  it("enables only claude out of the box", () => {
    const enabled = PROVIDER_ACCOUNT_CAPABILITIES.filter((entry) => entry.enabled);
    expect(enabled.map((entry) => entry.provider)).toEqual(["claude"]);
  });

  it("declares the claude multi-sign-in layout", () => {
    const claude = findProviderAccountCapability("claude");
    expect(claude).toMatchObject({
      configDirEnv: "CLAUDE_CONFIG_DIR",
      primaryDirName: ".claude",
      credentialFiles: [".credentials.json"],
    });
    expect(claude?.linkableFolders).toEqual([
      "commands",
      "skills",
      "agents",
      "projects",
      "sessions",
      "shell-snapshots",
    ]);
  });

  it("declares every provider a client may later enable", () => {
    const providers = PROVIDER_ACCOUNT_CAPABILITIES.map((entry) => entry.provider);
    expect(providers).toContain("codex");
    expect(providers).toContain("opencode");
    expect(providers).toContain("pi");
    expect(providers).toContain("copilot");
  });

  it("has a unique config dir env per provider", () => {
    const envs = PROVIDER_ACCOUNT_CAPABILITIES.map((entry) => entry.configDirEnv);
    expect(new Set(envs).size).toBe(envs.length);
  });
});

describe("ProviderAccountStateSchema", () => {
  it("parses a daemon-computed account state", () => {
    const parsed = ProviderAccountStateSchema.parse({
      id: "acc-1",
      provider: "claude",
      name: "peter",
      configDir: "/home/user/.claude-peter",
      linkedFolders: ["skills"],
      createdAt: "2026-09-17T00:00:00.000Z",
      authenticated: true,
      isActive: false,
    });
    expect(parsed.lastAuthenticatedAt).toBeUndefined();
    expect(parsed.authenticated).toBe(true);
  });
});
