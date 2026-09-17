import { describe, expect, it } from "vitest";
import {
  PROVIDER_ACCOUNT_CAPABILITIES,
  findProviderAccountCapability,
  type ProviderAccountCapability,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";
import {
  buildProviderAccountCreatePayload,
  previewProviderAccountConfigDir,
  selectEnabledCapabilities,
  selectProviderAccounts,
  validateProviderAccountName,
} from "./model";

const claude = findProviderAccountCapability("claude") as ProviderAccountCapability;

function account(overrides: Partial<ProviderAccountState>): ProviderAccountState {
  return {
    id: "a1",
    provider: "claude",
    name: "work",
    configDir: "/home/dev/.claude-work",
    linkedFolders: [],
    createdAt: "2026-09-17T00:00:00.000Z",
    authenticated: false,
    isActive: false,
    ...overrides,
  };
}

describe("provider account name validation", () => {
  it("accepts a lowercase slug", () => {
    expect(validateProviderAccountName("work")).toEqual({ status: "valid", slug: "work" });
    expect(validateProviderAccountName("team-two")).toEqual({ status: "valid", slug: "team-two" });
  });

  it("derives the slug from surrounding whitespace and case", () => {
    expect(validateProviderAccountName("  WORK  ")).toEqual({ status: "valid", slug: "work" });
  });

  it("reports an empty name separately from an invalid one", () => {
    expect(validateProviderAccountName("   ").status).toBe("empty");
  });

  it("rejects names that cannot be a directory suffix", () => {
    for (const name of ["work account", "work_account", "-work", "work-", "work--two", "wörk"]) {
      expect(validateProviderAccountName(name)).toEqual({ status: "invalid", slug: null });
    }
  });

  it("rejects a name already used by that provider", () => {
    expect(validateProviderAccountName("Work", ["work"])).toEqual({
      status: "duplicate",
      slug: "work",
    });
  });
});

describe("config directory preview", () => {
  it("shows the directory the daemon will create", () => {
    expect(previewProviderAccountConfigDir(claude, "work")).toBe("~/.claude-work");
  });

  it("shows nothing until the name is a slug", () => {
    expect(previewProviderAccountConfigDir(claude, null)).toBeNull();
  });
});

describe("disabled provider gating", () => {
  it("renders only providers the daemon enabled", () => {
    const enabled = selectEnabledCapabilities(PROVIDER_ACCOUNT_CAPABILITIES);
    expect(enabled.map((capability) => capability.provider)).toEqual(["claude"]);
  });

  it("drives the list off the payload, not a hardcoded provider id", () => {
    const capabilities: ProviderAccountCapability[] = [
      { ...claude, provider: "claude", enabled: false },
      { ...claude, provider: "codex", enabled: true },
    ];
    expect(selectEnabledCapabilities(capabilities).map((entry) => entry.provider)).toEqual([
      "codex",
    ]);
  });

  it("scopes accounts to their provider", () => {
    const accounts = [account({ id: "a" }), account({ id: "b", provider: "codex" })];
    expect(selectProviderAccounts(accounts, "claude").map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("create payload", () => {
  it("sends the derived slug and the selected folders", () => {
    expect(
      buildProviderAccountCreatePayload({
        capability: claude,
        name: " Work ",
        selectedFolders: ["skills", "commands"],
      }),
    ).toEqual({
      provider: "claude",
      name: "work",
      // Ordered by the capability manifest, not by click order.
      linkedFolders: ["commands", "skills"],
    });
  });

  it("defaults to every linkable folder when none were unchecked", () => {
    const payload = buildProviderAccountCreatePayload({
      capability: claude,
      name: "work",
      selectedFolders: claude.linkableFolders,
    });
    expect(payload?.linkedFolders).toEqual(claude.linkableFolders);
  });

  it("drops folders the capability does not declare", () => {
    const payload = buildProviderAccountCreatePayload({
      capability: claude,
      name: "work",
      selectedFolders: ["skills", "secrets"],
    });
    expect(payload?.linkedFolders).toEqual(["skills"]);
  });

  it("refuses to build a payload from an invalid name", () => {
    expect(
      buildProviderAccountCreatePayload({
        capability: claude,
        name: "not a slug",
        selectedFolders: [],
      }),
    ).toBeNull();
  });
});
