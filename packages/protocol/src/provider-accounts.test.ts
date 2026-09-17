import { describe, expect, it } from "vitest";

import {
  findEnabledUnverifiedProviders,
  findProviderAccountCapability,
  isProviderAccountCapabilityUnverified,
  PROVIDER_ACCOUNT_CAPABILITIES,
  ProviderAccountCapabilitySchema,
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

  it("marks every entry it does not enable as unverified, with a reason", () => {
    for (const capability of PROVIDER_ACCOUNT_CAPABILITIES) {
      expect(capability.verified).toBe(capability.enabled);
      if (capability.verified === false) {
        expect(capability.verificationNote?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe("isProviderAccountCapabilityUnverified", () => {
  it("only treats an explicit false as unverified", () => {
    expect(isProviderAccountCapabilityUnverified({ verified: false })).toBe(true);
    expect(isProviderAccountCapabilityUnverified({ verified: true })).toBe(false);
    // Absent means "not stated" - an older daemon - and must not raise a warning.
    expect(isProviderAccountCapabilityUnverified({ verified: undefined })).toBe(false);
  });
});

describe("findEnabledUnverifiedProviders", () => {
  it("reports only the unverified providers a config override switches on", () => {
    expect(
      findEnabledUnverifiedProviders({
        claude: { enabled: true },
        codex: { enabled: true },
        copilot: { enabled: true },
        pi: { enabled: false },
        opencode: {},
      }),
    ).toEqual(["codex", "copilot"]);
  });

  it("is empty for no overrides and for unknown providers", () => {
    expect(findEnabledUnverifiedProviders(undefined)).toEqual([]);
    expect(findEnabledUnverifiedProviders({})).toEqual([]);
    expect(findEnabledUnverifiedProviders({ nonesuch: { enabled: true } })).toEqual([]);
  });
});

describe("ProviderAccountCapabilitySchema", () => {
  const base = {
    provider: "claude",
    configDirEnv: "CLAUDE_CONFIG_DIR",
    primaryDirName: ".claude",
    linkableFolders: [],
    loginCommand: { command: "claude", args: [] },
    credentialFiles: [".credentials.json"],
    enabled: true,
  };

  it("keeps the verification fields optional, so an older daemon still parses", () => {
    expect(ProviderAccountCapabilitySchema.parse(base).verified).toBeUndefined();
  });

  it("round-trips the verification fields when present", () => {
    const parsed = ProviderAccountCapabilitySchema.parse({
      ...base,
      enabled: false,
      verified: false,
      verificationNote: "never confirmed",
    });
    expect(parsed.verified).toBe(false);
    expect(parsed.verificationNote).toBe("never confirmed");
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
