import { describe, expect, it } from "vitest";
import type { ProviderAccountState } from "@frogg/protocol/provider-accounts";
import {
  buildUsageAccountsByProvider,
  resolveSelectedUsageAccountId,
  resolveUsageAccountScopeId,
  shouldShowUsageAccountTabs,
} from "./accounts";

function account(overrides: Partial<ProviderAccountState> & { id: string }): ProviderAccountState {
  return {
    provider: "claude",
    name: overrides.id,
    configDir: `~/.claude-${overrides.id}`,
    linkedFolders: [],
    createdAt: "",
    authenticated: true,
    isActive: false,
    ...overrides,
  };
}

describe("resolveUsageAccountScopeId", () => {
  it("asks for the primary config dir for the implicit default account", () => {
    // The default tab's id is a protocol id, not a stored account: every daemon
    // understands `null` for its primary directory, older ones included.
    expect(resolveUsageAccountScopeId("default:claude")).toBeNull();
  });

  it("asks for a stored account by its own id", () => {
    expect(resolveUsageAccountScopeId("acct-steve")).toBe("acct-steve");
  });
});

describe("shouldShowUsageAccountTabs", () => {
  it("shows no switcher for a single sign-in", () => {
    expect(shouldShowUsageAccountTabs([account({ id: "acct-steve" })])).toBe(false);
  });

  it("shows a switcher once a provider has more than one sign-in", () => {
    expect(
      shouldShowUsageAccountTabs([account({ id: "acct-steve" }), account({ id: "acct-steve-2" })]),
    ).toBe(true);
  });
});

describe("resolveSelectedUsageAccountId", () => {
  const accounts = [account({ id: "acct-steve" }), account({ id: "acct-steve-2", isActive: true })];

  it("opens on the account in use", () => {
    expect(resolveSelectedUsageAccountId(accounts, null)).toBe("acct-steve-2");
  });

  it("keeps a tab chosen by hand", () => {
    expect(resolveSelectedUsageAccountId(accounts, "acct-steve")).toBe("acct-steve");
  });

  it("falls back when the chosen account has been deleted", () => {
    expect(resolveSelectedUsageAccountId(accounts, "acct-gone")).toBe("acct-steve-2");
  });
});

describe("buildUsageAccountsByProvider", () => {
  const addDefault = (
    providerAccounts: readonly ProviderAccountState[],
    providerId: string,
  ): ProviderAccountState[] => [
    account({ id: `default:${providerId}`, provider: providerId }),
    ...providerAccounts,
  ];

  it("groups each provider's sign-ins and guarantees the default a tab", () => {
    const result = buildUsageAccountsByProvider(
      [
        account({ id: "acct-steve" }),
        account({ id: "acct-steve-2" }),
        account({ id: "acct-codex", provider: "codex" }),
      ],
      addDefault,
    );

    expect(result.get("claude")?.map((entry) => entry.id)).toEqual([
      "default:claude",
      "acct-steve",
      "acct-steve-2",
    ]);
    expect(result.get("codex")?.map((entry) => entry.id)).toEqual(["default:codex", "acct-codex"]);
  });

  it("leaves out a provider the daemon stores no account for", () => {
    // Its card already describes its only sign-in, so a lone "Default" tab
    // would be a row that cannot be used.
    expect(buildUsageAccountsByProvider([], addDefault).has("cursor")).toBe(false);
  });
});
