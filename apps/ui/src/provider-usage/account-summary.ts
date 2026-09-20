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
 * One window as the small meter it occupies in the picker: a caption, a bar
 * and a countdown. Kept as parts rather than one formatted string so the view
 * can tint the figure and size the bar; the spoken line joins them back up.
 */
export interface ProviderUsageColumn {
  id: string;
  /** The window's name, as `Session` or `Weekly`. */
  label: string;
  /** How much of the window is spent, 0–100, or null when unreported. */
  pct: number | null;
  /** The spent share as text, `42%` or an em dash when unreported. */
  pctLabel: string;
  /** How long until the window resets, or null when the provider omits it. */
  resetIn: string | null;
}

/** One window's meter, or null when the window says nothing worth a row. */
export function formatWindowColumn(window: ProviderUsageWindow): ProviderUsageColumn | null {
  const pct = usedPct(window);
  const resetIn = formatCountdown(window.resetsAt);
  if (pct == null && !resetIn) return null;
  return {
    id: window.id,
    label: window.label,
    pct,
    pctLabel: pct != null ? formatPct(pct) : "—",
    resetIn,
  };
}

/** One window rendered as `Session 42% · 3h 10m`, for screen readers. */
export function formatWindowSummary(window: ProviderUsageWindow): string | null {
  const column = formatWindowColumn(window);
  if (!column) return null;
  const used = `${column.label} ${column.pctLabel}`;
  return column.resetIn ? `${used} · ${column.resetIn}` : used;
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
