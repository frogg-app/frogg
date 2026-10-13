import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { PROVIDER_ACCOUNT_DEFAULT_NAME } from "@frogg/protocol/provider-accounts";
import { useEffect } from "react";
import { create } from "zustand";
import { usePrefs } from "../prefs";
import { getClient, onHostSwitch, useDaemon } from "./store";

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
  /** Set while the provider is rate-limiting usage reads; automatic refreshes wait until then. */
  backoffUntil: number | null;
}

export const useUsage = create<UsageState>(() => ({
  groups: null,
  fetchedAt: null,
  loading: false,
  error: null,
  backoffUntil: null,
}));

onHostSwitch(() => {
  inflight = null;
  backoffMs = 0;
  useUsage.setState({ groups: null, fetchedAt: null, error: null, backoffUntil: null });
});

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const RATE_LIMITED = /\b429\b|rate.?limit|too many requests/i;
const BACKOFF_MIN_MS = 2 * 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;
let backoffMs = 0;
let inflight: { client: DaemonClient; promise: Promise<void> } | null = null;

function limited(groups: UsageGroup[]): boolean {
  return groups.some(
    (g) =>
      RATE_LIMITED.test(g.usage.error ?? "") ||
      g.accounts.some((a) => RATE_LIMITED.test(a.error ?? a.usage?.error ?? "")),
  );
}

/** Doubles the wait on every rate-limited answer and clears it on the first clean one. */
function noteRateLimit(hit: boolean): void {
  backoffMs = hit ? Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, backoffMs * 2)) : 0;
  useUsage.setState({ backoffUntil: hit ? Date.now() + backoffMs : null });
}

/**
 * The figures behind both usage views. The unscoped read covers every
 * provider; a provider with several sign-ins is then read once per account,
 * because the unscoped answer only describes its primary config dir.
 *
 * Concurrent callers share one request. `auto` reads (timer, hover, after a reply) are skipped
 * while the provider is rate-limiting; a manual refresh still goes, but never forces past the
 * daemon's cache during a backoff.
 *
 * COMPAT(providerUsageAccountScoped): a daemon without the flag ignores the
 * scope and would file its default answer under every account, so it gets the
 * per-provider view only.
 */
export function loadUsage(maxAgeMs?: number, opts: { auto?: boolean } = {}): Promise<void> {
  const client = getClient();
  if (!client) return Promise.resolve();
  if (inflight?.client === client) return inflight.promise;
  const until = useUsage.getState().backoffUntil;
  const backingOff = until !== null && Date.now() < until;
  if (opts.auto && backingOff) return Promise.resolve();
  const promise = readAll(client, backingOff && maxAgeMs === 0 ? undefined : maxAgeMs).finally(
    () => {
      if (inflight?.promise === promise) inflight = null;
    },
  );
  inflight = { client, promise };
  return promise;
}

async function readAll(client: DaemonClient, maxAgeMs: number | undefined): Promise<void> {
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
        return {
          ...group,
          accounts: await Promise.all(list.map((a) => readAccount(client, a, maxAgeMs))),
        };
      }),
    );
    if (getClient() !== client) return;
    noteRateLimit(limited(groups));
    useUsage.setState({ groups, fetchedAt: base.fetchedAt, error: null });
  } catch (e) {
    if (getClient() !== client) return;
    noteRateLimit(RATE_LIMITED.test(message(e)));
    useUsage.setState({ error: message(e) });
  } finally {
    useUsage.setState({ loading: false });
  }
}

// ---- automatic refresh (Settings → Usage & limits → Meters) ----

let viewers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/** One timer for every mounted usage view, at the user's interval (never under 30 s). */
function syncTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
  const p = usePrefs.getState();
  if (viewers < 1 || !p.meterTimer) return;
  const ms = Math.max(30, p.meterSeconds) * 1000;
  // Figures younger than the interval are fine: let the daemon answer from its cache.
  timer = setInterval(() => void loadUsage(ms - 5000, { auto: true }), ms);
}
usePrefs.subscribe((s, prev) => {
  if (s.meterTimer !== prev.meterTimer || s.meterSeconds !== prev.meterSeconds) syncTimer();
});

/** Mount in every view that shows usage figures; keeps the refresh timer running while one is. */
export function useUsageAutoRefresh(): void {
  useEffect(() => {
    viewers += 1;
    syncTimer();
    return () => {
      viewers -= 1;
      syncTimer();
    };
  }, []);
}

/** Pointer over a meter: refresh when the user turned that on. */
export function refreshOnHover(): void {
  if (usePrefs.getState().meterHover) void loadUsage(60_000, { auto: true });
}

// A turn finishing spends quota: refresh then, when the user turned that on and figures are shown.
useDaemon.subscribe((s, prev) => {
  if (s.sessions === prev.sessions || !usePrefs.getState().meterAfterReply) return;
  if (!useUsage.getState().groups) return;
  const finished = Object.values(s.sessions).some(
    (x) => x.agent.status !== "running" && prev.sessions[x.agent.id]?.agent.status === "running",
  );
  if (finished) void loadUsage(30_000, { auto: true });
});

async function readAccount(
  client: DaemonClient,
  account: ProviderAccount,
  maxAgeMs?: number,
): Promise<AccountUsage> {
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
