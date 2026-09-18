import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_ACCOUNT_OPTION_ID,
  resolveProviderAccountControlModel,
  shouldShowProviderAccountPill,
  toProviderAccountOptionId,
  toProviderAccountSelection,
} from "./provider-account";

const STEVE = { id: "acct-steve", name: "steve", authenticated: true };
const NEW = { id: "acct-new", name: "new-hire", authenticated: false };

describe("resolveProviderAccountControlModel", () => {
  it("renders nothing when the provider advertises no accounts capability", () => {
    expect(
      resolveProviderAccountControlModel({
        accounts: undefined,
        defaultAccountId: null,
        selection: undefined,
      }),
    ).toBeNull();
  });

  it("renders nothing when the provider has an accounts capability but no accounts", () => {
    expect(
      resolveProviderAccountControlModel({
        accounts: [],
        defaultAccountId: null,
        selection: undefined,
      }),
    ).toBeNull();
  });

  it("offers a Default row plus one row per account", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE, NEW],
      defaultAccountId: null,
      selection: undefined,
    });
    expect(model?.options.map((option) => option.id)).toEqual([
      DEFAULT_PROVIDER_ACCOUNT_OPTION_ID,
      "acct-steve",
      "acct-new",
    ]);
    expect(model?.options[0]?.label).toBe("Default");
  });

  // The Default row sends `null`, which pins the primary config dir and ignores
  // the daemon-wide active account. Naming that account here would claim the row
  // selects it, when it does the opposite — and the account has its own row.
  it("does not name the daemon-wide active account on the Default row", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE],
      defaultAccountId: "acct-steve",
      selection: undefined,
    });
    expect(model?.options[0]?.label).toBe("Default");
    expect(model?.displayLabel).toBe("Default");
  });

  it("highlights Default for an absent selection and for an explicit null", () => {
    const accounts = [STEVE];
    for (const selection of [undefined, null] as const) {
      const model = resolveProviderAccountControlModel({
        accounts,
        defaultAccountId: null,
        selection,
      });
      expect(model?.selectedOptionId).toBe(DEFAULT_PROVIDER_ACCOUNT_OPTION_ID);
    }
  });

  // Read-only surfaces describe an agent that is already running, where an
  // absent selection resolved to the provider's active account at launch.
  it("resolves an absent selection to the active account only when asked to", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE],
      defaultAccountId: "acct-steve",
      selection: undefined,
      resolveAbsentToActiveAccount: true,
    });
    expect(model?.selectedOptionId).toBe("acct-steve");
    expect(model?.displayLabel).toBe("steve");
  });

  it("leaves an explicit null on Default even when resolving absent selections", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE],
      defaultAccountId: "acct-steve",
      selection: null,
      resolveAbsentToActiveAccount: true,
    });
    expect(model?.selectedOptionId).toBe(DEFAULT_PROVIDER_ACCOUNT_OPTION_ID);
  });

  it("marks an account with no credentials as not ready", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE, NEW],
      defaultAccountId: null,
      selection: "acct-new",
    });
    expect(model?.options.find((option) => option.id === "acct-new")?.authenticated).toBe(false);
    expect(model?.selectedIsUnauthenticated).toBe(true);
  });

  it("falls back to Default when the selected account was deleted while open", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE],
      defaultAccountId: null,
      selection: "acct-gone",
    });
    expect(model?.selectedOptionId).toBe(DEFAULT_PROVIDER_ACCOUNT_OPTION_ID);
    expect(model?.displayLabel).toBe("Default");
  });
});

describe("shouldShowProviderAccountPill", () => {
  it("hides the pill when the provider has no accounts", () => {
    expect(shouldShowProviderAccountPill({ isRunning: true, accountsCount: 0 })).toBe(false);
  });

  it("shows the pill for a single account — a launched agent's account is fixed", () => {
    expect(shouldShowProviderAccountPill({ isRunning: true, accountsCount: 1 })).toBe(true);
  });

  it("shows the pill when a provider has several accounts", () => {
    expect(shouldShowProviderAccountPill({ isRunning: true, accountsCount: 2 })).toBe(true);
  });

  it("hides the pill when the agent is not running, even with multiple accounts", () => {
    expect(shouldShowProviderAccountPill({ isRunning: false, accountsCount: 3 })).toBe(false);
  });
});

describe("provider account option ids", () => {
  it("maps both absent and null selections onto the Default row", () => {
    expect(toProviderAccountOptionId(undefined)).toBe(DEFAULT_PROVIDER_ACCOUNT_OPTION_ID);
    expect(toProviderAccountOptionId(null)).toBe(DEFAULT_PROVIDER_ACCOUNT_OPTION_ID);
    expect(toProviderAccountOptionId("acct-steve")).toBe("acct-steve");
  });

  it("turns the Default row into an explicit null rather than an absent value", () => {
    const picked = toProviderAccountSelection(DEFAULT_PROVIDER_ACCOUNT_OPTION_ID);
    expect(picked).toBeNull();
    expect(picked).not.toBeUndefined();
    expect(toProviderAccountSelection("acct-steve")).toBe("acct-steve");
  });
});
