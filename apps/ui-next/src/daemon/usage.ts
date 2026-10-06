import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { PROVIDER_ACCOUNT_DEFAULT_NAME } from "@frogg/protocol/provider-accounts";
import { create } from "zustand";
import { getClient, onHostSwitch } from "./store";

type UsageList = Awaited<ReturnType<DaemonClient["listProviderUsage"]>>;
export type ProviderUsage = UsageList["providers"][number];
export type UsageWindow = ProviderUsage["windows"][number];
type AccountList = Awaited<ReturnType<DaemonClient["listProviderAccounts"]>>;
export type ProviderAccount = AccountList["accounts"][number];

/** One sign-in of a provider and the figures the daemon read from its config dir. */
export interface AccountUsage {
  account: ProviderAccount;
  /** Null when the scoped read failed outright; `error` says why. */
  usage: ProviderUsage | null;
  error: string | null;
}

/**
 * A provider as the usage views show it. `accounts` is empty for a provider
 * with a single sign-in (or a daemon without accounts), and `usage` is then the
 * whole story; with two or more sign-ins each one carries its own figures.
 */
export interface UsageGroup {
  providerId: string;
  displayName: string;
  usage: ProviderUsage;
  accounts: AccountUsage[];
}

interface UsageState {
  groups: UsageGroup[] | null;
  fetchedAt: string | null;
  loading: boolean;
  error: string | null;
}

export const useUsage = create<UsageState>(() => ({
  groups: null,
  fetchedAt: null,
  loading: false,
  error: null,
}));

onHostSwitch(() => useUsage.setState({ groups: null, fetchedAt: null, error: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The figures behind both usage views. The unscoped read covers every
 * provider; a provider with several sign-ins is then read once per account,
 * because the unscoped answer only describes its primary config dir.
 *
 * COMPAT(providerUsageAccountScoped): a daemon without the flag ignores the
 * scope and would file its default answer under every account, so it gets the
 * per-provider view only.
 */
export async function loadUsage(maxAgeMs?: number): Promise<void> {
  const client = getClient();
  if (!client) return;
  const features = client.getLastServerInfoMessage()?.features;
  const scoped = features?.providerUsageAccountScoped === true;
  useUsage.setState({ loading: true });
  try {
    const [base, accounts] = await Promise.all([
      client.listProviderUsage({ maxAgeMs }),
      scoped && features?.providerAccounts === true
        ? client.listProviderAccounts().catch(() => null)
        : Promise.resolve(null),
    ]);
    const byProvider = new Map<string, ProviderAccount[]>();
    for (const a of accounts?.accounts ?? []) {
      byProvider.set(a.provider, [...(byProvider.get(a.provider) ?? []), a]);
    }
    const groups = await Promise.all(
      base.providers.map(async (usage): Promise<UsageGroup> => {
        const list = byProvider.get(usage.providerId) ?? [];
        const group = { providerId: usage.providerId, displayName: usage.displayName, usage };
        if (list.length < 2) return { ...group, accounts: [] };
        return { ...group, accounts: await Promise.all(list.map((a) => readAccount(a, maxAgeMs))) };
      }),
    );
    if (getClient() !== client) return;
    useUsage.setState({ groups, fetchedAt: base.fetchedAt, error: null });
  } catch (e) {
    if (getClient() === client) useUsage.setState({ error: message(e) });
  } finally {
    useUsage.setState({ loading: false });
  }
}

async function readAccount(account: ProviderAccount, maxAgeMs?: number): Promise<AccountUsage> {
  const client = getClient();
  if (!client) return { account, usage: null, error: "host offline" };
  try {
    const res = await client.listProviderUsage({
      provider: account.provider,
      providerAccountId: account.id,
      maxAgeMs,
    });
    const usage = res.providers.find((u) => u.providerId === account.provider) ?? null;
    return { account, usage, error: null };
  } catch (e) {
    return { account, usage: null, error: message(e) };
  }
}

/** A window's used share, whichever way round the provider reports it. */
export function usedPct(w: UsageWindow): number | null {
  if (w.usedPct != null) return w.usedPct;
  return w.remainingPct != null ? 100 - w.remainingPct : null;
}

/** Whether a group's figures are worth showing at all. */
export function groupReports(g: UsageGroup): boolean {
  if (g.accounts.length === 0) return g.usage.status !== "unavailable";
  return g.accounts.some((a) => a.usage?.status !== "unavailable" || a.error !== null);
}

/** The account's display name; the implicit primary account keeps a reserved id-like name. */
export function accountName(a: ProviderAccount): string {
  return a.name === PROVIDER_ACCOUNT_DEFAULT_NAME ? "Default" : a.name;
}

/** Figures older than this are flagged as stale in the views. */
export const STALE_MS = 15 * 60_000;

export function isStale(iso: string | null | undefined): boolean {
  return !!iso && Date.now() - Date.parse(iso) > STALE_MS;
}

/** The fullest window across every account of a group, for a collapsed summary. */
export function peakWindow(
  g: UsageGroup,
): { pct: number; label: string; account: string | null } | null {
  let best: { pct: number; label: string; account: string | null } | null = null;
  const sources: Array<{ usage: ProviderUsage | null; account: string | null }> =
    g.accounts.length > 0
      ? g.accounts.map((a) => ({ usage: a.usage, account: accountName(a.account) }))
      : [{ usage: g.usage, account: null }];
  for (const src of sources) {
    for (const w of src.usage?.windows ?? []) {
      const pct = usedPct(w);
      if (pct !== null && (!best || pct > best.pct))
        best = { pct, label: w.label, account: src.account };
    }
  }
  return best;
}
