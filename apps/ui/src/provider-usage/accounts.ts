import {
  parseProviderAccountDefaultId,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";

/**
 * COMPAT(providerUsageAccountScoped): the `providerAccountId` a tab's figures
 * are read for. The implicit default account's tab id is a protocol id rather
 * than a stored account, so it goes on the wire as `null` — the provider's
 * primary config directory, which every daemon understands. Mirrors the
 * provider settings sheet, so the same account reports the same numbers
 * wherever it is shown.
 */
export function resolveUsageAccountScopeId(accountId: string): string | null {
  return parseProviderAccountDefaultId(accountId) !== null ? null : accountId;
}

/**
 * Whether a provider's usage gets an account switcher. One sign-in needs no
 * tabs: the figures on the card are already that account's, and a lone tab
 * would only add a row that cannot be used.
 */
export function shouldShowUsageAccountTabs(accounts: readonly ProviderAccountState[]): boolean {
  return accounts.length > 1;
}

/**
 * The tab to open on: the account in use, falling back to the first listed.
 * `selectedAccountId` wins whenever it still names a listed account, so a tab
 * chosen by hand survives the list being refetched but not the account behind
 * it being deleted.
 */
export function resolveSelectedUsageAccountId(
  accounts: readonly ProviderAccountState[],
  selectedAccountId: string | null,
): string | null {
  if (selectedAccountId && accounts.some((account) => account.id === selectedAccountId)) {
    return selectedAccountId;
  }
  const preferred = accounts.find((account) => account.isActive) ?? accounts[0];
  return preferred?.id ?? null;
}

/**
 * The tabs each provider gets, keyed by provider id.
 *
 * A provider the daemon has stored no account for is left out entirely rather
 * than given a lone synthesized "Default" tab: it has one sign-in, and its card
 * already describes it. Providers that do have accounts are guaranteed a tab for
 * the implicit default sign-in, which older daemons list only once something has
 * been stored about it.
 */
export function buildUsageAccountsByProvider(
  accounts: readonly ProviderAccountState[],
  withDefaultAccount: (
    accounts: readonly ProviderAccountState[],
    providerId: string,
  ) => ProviderAccountState[],
): Map<string, ProviderAccountState[]> {
  const byProvider = new Map<string, ProviderAccountState[]>();
  for (const account of accounts) {
    const existing = byProvider.get(account.provider);
    if (existing) {
      existing.push(account);
    } else {
      byProvider.set(account.provider, [account]);
    }
  }
  return new Map(
    [...byProvider].map(([providerId, providerAccounts]) => [
      providerId,
      withDefaultAccount(providerAccounts, providerId),
    ]),
  );
}
