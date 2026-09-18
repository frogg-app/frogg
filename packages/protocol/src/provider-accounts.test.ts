import { describe, expect, it } from "vitest";

import {
  findEnabledHomeModeProviders,
  findEnabledUnverifiedProviders,
  findProviderAccountCapability,
  isProviderAccountCapabilityUnverified,
  normalizeProviderAccountDisplayName,
  parseProviderAccountDefaultId,
  providerAccountDefaultId,
  PROVIDER_ACCOUNT_CAPABILITIES,
  PROVIDER_ACCOUNT_EXPORT_BUNDLE_VERSION,
  PROVIDER_ACCOUNT_HOME_ENV,
  providerAccountConfigDirMode,
  providerAccountHomeLinks,
  ProviderAccountCapabilitySchema,
  ProviderAccountExportBundleSchema,
  ProviderAccountSchema,
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
  it("enables only the verified providers out of the box", () => {
    const enabled = PROVIDER_ACCOUNT_CAPABILITIES.filter((entry) => entry.enabled);
    expect(enabled.map((entry) => entry.provider)).toEqual(["claude", "codex"]);
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
    expect(providers).toContain("gemini");
    expect(providers).toContain("opencode");
    expect(providers).toContain("pi");
    expect(providers).toContain("copilot");
  });

  it("has a unique config dir env per provider", () => {
    const envs = PROVIDER_ACCOUNT_CAPABILITIES.map((entry) => entry.configDirEnv);
    expect(new Set(envs).size).toBe(envs.length);
  });

  it("states a reason for every entry it does not enable", () => {
    for (const capability of PROVIDER_ACCOUNT_CAPABILITIES) {
      // Enabled entries are always verified. A disabled entry is either an
      // unverified guess, or - like gemini - verified but opt-in because
      // enabling it has side effects; both owe an explanation.
      if (capability.enabled) {
        expect(capability.verified).toBe(true);
        expect(capability.verificationNote).toBeUndefined();
      } else {
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
        gemini: { enabled: true },
        copilot: { enabled: true },
        pi: { enabled: false },
        opencode: {},
      }),
      // gemini is verified against the published package, so it is not listed.
    ).toEqual(["copilot"]);
  });

  it("is empty for no overrides and for unknown providers", () => {
    expect(findEnabledUnverifiedProviders(undefined)).toEqual([]);
    expect(findEnabledUnverifiedProviders({})).toEqual([]);
    expect(findEnabledUnverifiedProviders({ nonesuch: { enabled: true } })).toEqual([]);
    expect(findEnabledUnverifiedProviders({ gemini: { enabled: true } })).toEqual([]);
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

describe("the gemini capability entry", () => {
  const gemini = findProviderAccountCapability("gemini");

  it("redirects HOME because the Gemini CLI has no config-dir variable", () => {
    expect(gemini).toBeDefined();
    expect(gemini?.configDirMode).toBe("home");
    expect(gemini?.configDirEnv).toBe(PROVIDER_ACCOUNT_HOME_ENV);
    expect(gemini?.primaryDirName).toBe(".gemini");
    // Relative to the synthetic home, so they land in <accountDir>/.gemini.
    expect(gemini?.credentialFiles).toEqual([
      ".gemini/oauth_creds.json",
      ".gemini/google_accounts.json",
    ]);
    expect(ProviderAccountCapabilitySchema.safeParse(gemini).success).toBe(true);
  });

  it("links the shared home state a synthetic HOME would otherwise hide", () => {
    expect(providerAccountHomeLinks(gemini!)).toEqual([
      ".npm",
      ".npmrc",
      ".cache",
      ".gitconfig",
      ".ssh",
      ".config/gcloud",
    ]);
  });

  it("logs in through npx, since no gemini binary is installed", () => {
    expect(gemini?.loginCommand).toEqual({
      command: "npx",
      args: ["-y", "@google/gemini-cli@0.52.0"],
    });
  });

  it("ships opt-in but with its values verified against the package", () => {
    expect(gemini?.enabled).toBe(false);
    expect(gemini?.verified).toBe(true);
    // Verified values, but no real sign-in was performed; say which is which.
    expect(gemini?.verificationNote).toMatch(/NOT confirmed/);
  });
});

describe("configDirMode", () => {
  const envBase = {
    provider: "claude",
    configDirEnv: "CLAUDE_CONFIG_DIR",
    primaryDirName: ".claude",
    linkableFolders: [],
    loginCommand: { command: "claude", args: [] },
    credentialFiles: [".credentials.json"],
    enabled: true,
  };

  it("treats an absent mode as env, so older entries are unchanged", () => {
    const parsed = ProviderAccountCapabilitySchema.parse(envBase);
    expect(parsed.configDirMode).toBeUndefined();
    expect(providerAccountConfigDirMode(parsed)).toBe("env");
    expect(providerAccountHomeLinks(parsed)).toEqual([]);
  });

  it("parses a capability that predates the field (wire compatibility)", () => {
    // An older daemon sends neither configDirMode nor homeLinks.
    expect(ProviderAccountCapabilitySchema.safeParse(envBase).success).toBe(true);
  });

  it("ignores homeLinks on an env-mode capability", () => {
    const parsed = ProviderAccountCapabilitySchema.parse({
      ...envBase,
      configDirMode: "env",
      homeLinks: [".npm"],
    });
    expect(providerAccountHomeLinks(parsed)).toEqual([]);
  });

  it("parses a home-mode capability", () => {
    const parsed = ProviderAccountCapabilitySchema.parse({
      ...envBase,
      provider: "gemini",
      configDirMode: "home",
      configDirEnv: PROVIDER_ACCOUNT_HOME_ENV,
      homeLinks: [".npm", ".gitconfig"],
    });
    expect(providerAccountConfigDirMode(parsed)).toBe("home");
    expect(providerAccountHomeLinks(parsed)).toEqual([".npm", ".gitconfig"]);
  });

  it("rejects an unknown mode and empty link names", () => {
    expect(
      ProviderAccountCapabilitySchema.safeParse({
        ...envBase,
        configDirMode: "symlink",
      }).success,
    ).toBe(false);
    expect(
      ProviderAccountCapabilitySchema.safeParse({
        ...envBase,
        configDirMode: "home",
        homeLinks: [""],
      }).success,
    ).toBe(false);
  });

  it("keeps every shipped entry but gemini in env mode", () => {
    for (const capability of PROVIDER_ACCOUNT_CAPABILITIES) {
      const expected = capability.provider === "gemini" ? "home" : "env";
      expect([capability.provider, providerAccountConfigDirMode(capability)]).toEqual([
        capability.provider,
        expected,
      ]);
      if (expected === "env") {
        expect(capability.homeLinks).toBeUndefined();
      }
    }
  });
});

describe("findEnabledHomeModeProviders", () => {
  it("reports home-mode providers a config override switches on", () => {
    expect(
      findEnabledHomeModeProviders({
        gemini: { enabled: true },
        claude: { enabled: true },
      }),
    ).toEqual(["gemini"]);
  });

  it("is empty when nothing enables one", () => {
    expect(findEnabledHomeModeProviders(undefined)).toEqual([]);
    expect(findEnabledHomeModeProviders({ gemini: { enabled: false } })).toEqual([]);
    expect(findEnabledHomeModeProviders({ claude: { enabled: true } })).toEqual([]);
  });
});

describe("the codex capability entry", () => {
  it("is enabled and verified against a real codex install", () => {
    const codex = findProviderAccountCapability("codex");
    expect(codex?.enabled).toBe(true);
    expect(codex?.verified).toBe(true);
    expect(codex?.verificationNote).toBeUndefined();
    expect(codex?.configDirEnv).toBe("CODEX_HOME");
    expect(codex?.credentialFiles).toEqual(["auth.json"]);
  });
});

describe("provider account default ids", () => {
  it("round-trips a provider through the default id", () => {
    expect(providerAccountDefaultId("claude")).toBe("default:claude");
    expect(parseProviderAccountDefaultId("default:claude")).toBe("claude");
  });

  it("returns null for a normal account id", () => {
    expect(parseProviderAccountDefaultId("6c0a-uuid")).toBeNull();
    expect(parseProviderAccountDefaultId("default:")).toBeNull();
  });
});

describe("normalizeProviderAccountDisplayName", () => {
  it("accepts free-form text a slug would reject", () => {
    expect(normalizeProviderAccountDisplayName("  Peter's Work Laptop  ")).toBe(
      "Peter's Work Laptop",
    );
  });

  it("rejects blank, over-long and multi-line names", () => {
    expect(normalizeProviderAccountDisplayName("   ")).toBeNull();
    expect(normalizeProviderAccountDisplayName("a".repeat(65))).toBeNull();
    expect(normalizeProviderAccountDisplayName("one\ntwo")).toBeNull();
  });
});

describe("allowedModels on the account schemas", () => {
  const base = {
    id: "acct-1",
    provider: "claude",
    name: "peter",
    configDir: "/home/u/.claude-peter",
    linkedFolders: [],
    createdAt: "2026-09-17T00:00:00.000Z",
  };

  it("is optional, so an older daemon's account still parses", () => {
    expect(ProviderAccountSchema.parse(base).allowedModels).toBeUndefined();
    expect(
      ProviderAccountStateSchema.parse({
        ...base,
        authenticated: false,
        isActive: false,
      }).allowedModels,
    ).toBeUndefined();
  });

  it("keeps an empty array distinct from absent", () => {
    expect(ProviderAccountSchema.parse({ ...base, allowedModels: [] }).allowedModels).toEqual([]);
    expect(ProviderAccountSchema.parse({ ...base, allowedModels: ["opus"] }).allowedModels).toEqual(
      ["opus"],
    );
  });
});

describe("ProviderAccountExportBundleSchema", () => {
  const bundle = {
    version: PROVIDER_ACCOUNT_EXPORT_BUNDLE_VERSION,
    provider: "claude",
    exportedAt: "2026-09-17T00:00:00.000Z",
    accounts: [
      {
        account: {
          id: "acct-1",
          provider: "claude",
          name: "peter",
          configDir: "/home/u/.claude-peter",
          linkedFolders: [],
          createdAt: "2026-09-17T00:00:00.000Z",
        },
        credentials: [{ file: ".credentials.json", contentsBase64: "e30=" }],
      },
    ],
  };

  it("parses a version 1 bundle", () => {
    const parsed = ProviderAccountExportBundleSchema.parse(bundle);
    expect(parsed.version).toBe(1);
    expect(parsed.accounts[0]?.credentials[0]?.file).toBe(".credentials.json");
  });

  it("rejects a bundle with no version", () => {
    const { version: _dropped, ...withoutVersion } = bundle;
    expect(ProviderAccountExportBundleSchema.safeParse(withoutVersion).success).toBe(false);
  });
});
