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

/**
 * One window's figures as the two cells it occupies in the picker's usage
 * grid: `Session 42%` and `3h 10m`. Split rather than pre-joined so every row
 * can right-anchor the same columns and have them line up top to bottom.
 */
export interface ProviderUsageColumn {
  id: string;
  /** The window's name and how much of it is spent, as `Session 42%`. */
  used: string;
  /** How long until the window resets, or null when the provider omits it. */
  resetIn: string | null;
}

/** One window's cells, or null when the window says nothing worth a row. */
export function formatWindowColumn(window: ProviderUsageWindow): ProviderUsageColumn | null {
  const pct = usedPct(window);
  const resetIn = formatCountdown(window.resetsAt);
  if (pct == null && !resetIn) return null;
  return {
    id: window.id,
    used: `${window.label} ${pct != null ? formatPct(pct) : "—"}`,
    resetIn,
  };
}

/** One window rendered as `Session 42% · 3h 10m`, for screen readers. */
export function formatWindowSummary(window: ProviderUsageWindow): string | null {
  const column = formatWindowColumn(window);
  if (!column) return null;
  return column.resetIn ? `${column.used} · ${column.resetIn}` : column.used;
}

function providerWindows(
  providers: readonly ProviderUsage[] | undefined,
  providerId: string | undefined,
): readonly ProviderUsageWindow[] {
  if (!providers || !providerId) return [];
  return providers.find((entry) => entry.providerId === providerId)?.windows ?? [];
}

/**
 * The usage cells for one account in the picker: each reported window's used
 * percentage and reset countdown, in the fixed column order every row shares.
 * Empty when the provider reports no window this client can say anything
 * useful about, so the row falls back to just the account name.
 */
export function buildProviderUsageColumns(
  providers: readonly ProviderUsage[] | undefined,
  providerId: string | undefined,
): ProviderUsageColumn[] {
  return providerWindows(providers, providerId)
    .map(formatWindowColumn)
    .filter((column): column is ProviderUsageColumn => column !== null)
    .slice(0, MAX_SUMMARY_WINDOWS);
}

/**
 * The same figures as one spoken line, used for the row's accessibility label
 * where a grid of columns has no meaning.
 */
export function summarizeProviderUsage(
  providers: readonly ProviderUsage[] | undefined,
  providerId: string | undefined,
): string | null {
  const summaries = providerWindows(providers, providerId)
    .map(formatWindowSummary)
    .filter((part): part is string => part !== null)
    .slice(0, MAX_SUMMARY_WINDOWS);
  return summaries.length > 0 ? summaries.join("  ·  ") : null;
}
