import { clampPct, formatPct } from "./format";
import type { ProviderUsage, ProviderUsageWindow } from "./types";

/**
 * How many rolling windows a one-line account summary names. Claude reports a
 * session (5h) window and a weekly (7d) one; providers that report more are
 * truncated rather than overflowing the combobox row.
 */
const MAX_SUMMARY_WINDOWS = 2;

/**
 * A compact "time until reset" — `3h 10m`, `4d 2h`, `12m`. Deliberately
 * coarser than a clock: the picker is a glance, not a countdown timer.
 */
export function formatCountdown(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(diffMs)) return null;
  if (diffMs <= 0) return "now";
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) {
    const remHours = hours - days * 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remMinutes = minutes - hours * 60;
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }
  return `${Math.max(1, minutes)}m`;
}

function usedPct(window: ProviderUsageWindow): number | null {
  if (window.usedPct != null) return clampPct(window.usedPct);
  if (window.remainingPct != null) return clampPct(100 - window.remainingPct);
  return null;
}

/** One window rendered as `Session 42% · 3h 10m`, or null when it says nothing. */
export function formatWindowSummary(window: ProviderUsageWindow): string | null {
  const pct = usedPct(window);
  const resetIn = formatCountdown(window.resetsAt);
  if (pct == null && !resetIn) return null;
  const parts = [window.label, pct != null ? formatPct(pct) : "—"];
  const head = parts.join(" ");
  return resetIn ? `${head} · ${resetIn}` : head;
}

/**
 * The inline usage line for one account in the picker: each reported window's
 * used percentage and how long until it resets, joined on one row. Null when
 * the provider reports no window this client can say anything useful about,
 * so the row falls back to just the account name.
 */
export function summarizeProviderUsage(
  providers: readonly ProviderUsage[] | undefined,
  providerId: string | undefined,
): string | null {
  if (!providers || !providerId) return null;
  const usage = providers.find((entry) => entry.providerId === providerId);
  if (!usage) return null;
  const summaries = usage.windows
    .map(formatWindowSummary)
    .filter((part): part is string => part !== null)
    .slice(0, MAX_SUMMARY_WINDOWS);
  return summaries.length > 0 ? summaries.join("  ·  ") : null;
}
