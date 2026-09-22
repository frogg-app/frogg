import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROVIDER_ACCOUNT_OPTION_ID,
  resolveEffectiveProviderAccountId,
  resolveProviderAccountControlModel,
  resolveProviderAccountTransferOptions,
  shouldShowCompactAccountToolbarControl,
  shouldShowProviderAccountPill,
  toProviderAccountOptionId,
  toProviderAccountSelection,
  type ProviderAccountSelection,
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

  // Once the daemon lists the provider's implicit default account, it IS the
  // Default row: listing both left a renamed default showing twice, under its
  // new name and again as "Default".
  it("uses the listed default account as the Default row instead of adding one", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [{ id: "default:claude", name: "Paz", authenticated: true }, STEVE],
      defaultAccountId: "acct-steve",
      selection: null,
    });
    expect(model?.options.map((option) => option.id)).toEqual(["default:claude", "acct-steve"]);
    expect(model?.options[0]?.label).toBe("Paz");
    expect(model?.options[0]?.isDefaultRow).toBe(true);
    // An explicit Default pick highlights that row rather than a sentinel id
    // no longer in the list.
    expect(model?.selectedOptionId).toBe("default:claude");
    expect(model?.displayLabel).toBe("Paz");
  });

  it("shows the listed default account as Default until it is renamed", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [{ id: "default:claude", name: "default", authenticated: true }],
      defaultAccountId: null,
      selection: undefined,
    });
    expect(model?.options[0]?.label).toBe("Default");
  });

  // The Default row sends `null`, which pins the primary config dir and ignores
  // the daemon-wide active account. Naming that account on the row would claim
  // the row selects it, when it does the opposite — and it has its own row.
  it("does not name the daemon-wide active account on the Default row", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE],
      defaultAccountId: "acct-steve",
      selection: undefined,
    });
    expect(model?.options[0]?.label).toBe("Default");
  });

  it("highlights Default for an absent selection when no account is active", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE],
      defaultAccountId: null,
      selection: undefined,
    });
    expect(model?.selectedOptionId).toBe(DEFAULT_PROVIDER_ACCOUNT_OPTION_ID);
  });

  // Regression: an untouched picker leaves `providerAccountId` off the launch
  // config, and the daemon then runs the agent as the active account. The
  // picker used to show "Default" here anyway, so a session started on
  // "Default" came up as steve. What is shown must be what launches.
  it("resolves an absent selection to the active account, in the picker too", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE],
      defaultAccountId: "acct-steve",
      selection: undefined,
    });
    expect(model?.selectedOptionId).toBe("acct-steve");
    expect(model?.displayLabel).toBe("steve");
  });

  it("keeps an explicit null on Default even when another account is active", () => {
    const model = resolveProviderAccountControlModel({
      accounts: [STEVE],
      defaultAccountId: "acct-steve",
      selection: null,
    });
    expect(model?.selectedOptionId).toBe(DEFAULT_PROVIDER_ACCOUNT_OPTION_ID);
    expect(model?.displayLabel).toBe("Default");
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

describe("resolveProviderAccountTransferOptions", () => {
  const modelFor = (selection: ProviderAccountSelection, defaultAccountId: string | null = null) =>
    resolveProviderAccountControlModel({ accounts: [STEVE, NEW], defaultAccountId, selection })!;

  it("offers every other account, and never the one the agent already runs as", () => {
    const options = resolveProviderAccountTransferOptions(modelFor("acct-steve"));

    expect(options.map((option) => option.id)).toEqual([
      DEFAULT_PROVIDER_ACCOUNT_OPTION_ID,
      "acct-new",
    ]);
  });

  it("offers the Default row as a destination like any other account", () => {
    const options = resolveProviderAccountTransferOptions(modelFor("acct-new"));

    expect(options.map((option) => option.label)).toEqual(["Default", "steve"]);
  });

  it("drops the Default row when the agent is the one already running on it", () => {
    expect(
      resolveProviderAccountTransferOptions(modelFor(null)).map((option) => option.id),
    ).toEqual(["acct-steve", "acct-new"]);
    expect(
      resolveProviderAccountTransferOptions(modelFor(undefined)).map((option) => option.id),
    ).toEqual(["acct-steve", "acct-new"]);
  });

  it("drops the daemon's active account when the agent launched without a pick", () => {
    // An absent selection runs as the active account, which the pill names; it
    // must not come back as a destination.
    const options = resolveProviderAccountTransferOptions(modelFor(undefined, "acct-steve"));

    expect(options.map((option) => option.id)).toEqual([
      DEFAULT_PROVIDER_ACCOUNT_OPTION_ID,
      "acct-new",
    ]);
  });

  it("carries the sign-in state through, so an unusable destination can be flagged", () => {
    const options = resolveProviderAccountTransferOptions(modelFor("acct-steve"));

    expect(options.find((option) => option.id === "acct-new")?.authenticated).toBe(false);
  });
});

describe("resolveEffectiveProviderAccountId", () => {
  it("sends an explicit pick even before the account list has arrived", () => {
    // The composer's snapshot is scoped per cwd, so creating a worktree moves
    // the scope and the list reloads under a pick the user already made.
    // Dropping the pick here left the key off the launch entirely and the
    // daemon fell back to its own active account.
    expect(
      resolveEffectiveProviderAccountId({
        accounts: undefined,
        selection: "acct-steve",
        storedDefaultAccountId: undefined,
        snapshotDefaultAccountId: "acct-new",
      }),
    ).toBe("acct-steve");
  });

  it("keeps an explicit Default pick distinct from having made no pick", () => {
    expect(
      resolveEffectiveProviderAccountId({
        accounts: [STEVE],
        selection: null,
        storedDefaultAccountId: "acct-steve",
        snapshotDefaultAccountId: "acct-steve",
      }),
    ).toBeNull();
  });

  it("falls back to this client's own default, which needs no account list", () => {
    expect(
      resolveEffectiveProviderAccountId({
        accounts: undefined,
        selection: undefined,
        storedDefaultAccountId: "acct-steve",
        snapshotDefaultAccountId: "acct-new",
      }),
    ).toBe("acct-steve");
  });

  it("uses the daemon's default once the list is known", () => {
    expect(
      resolveEffectiveProviderAccountId({
        accounts: [STEVE, NEW],
        selection: undefined,
        storedDefaultAccountId: undefined,
        snapshotDefaultAccountId: "acct-new",
      }),
    ).toBe("acct-new");
  });

  it("leaves the key off for a provider with no accounts at all", () => {
    expect(
      resolveEffectiveProviderAccountId({
        accounts: [],
        selection: undefined,
        storedDefaultAccountId: undefined,
        snapshotDefaultAccountId: null,
      }),
    ).toBeUndefined();
  });
});

describe("shouldShowCompactAccountToolbarControl", () => {
  it("promotes the picker to the toolbar once there is a choice to make", () => {
    expect(shouldShowCompactAccountToolbarControl({ accountsCount: 2, readOnly: false })).toBe(
      true,
    );
  });

  it("leaves a single sign-in inside the sheet", () => {
    expect(shouldShowCompactAccountToolbarControl({ accountsCount: 1, readOnly: false })).toBe(
      false,
    );
  });

  it("never promotes a launched agent's locked account", () => {
    expect(shouldShowCompactAccountToolbarControl({ accountsCount: 3, readOnly: true })).toBe(
      false,
    );
  });
});
