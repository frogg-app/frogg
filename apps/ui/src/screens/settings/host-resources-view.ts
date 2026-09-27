import type { OwnedStorageCategory } from "@frogg/protocol/messages";
import { formatBytes } from "./daemon-update-progress";

/**
 * Presentation helpers for the host Resources section: usage fractions,
 * byte/percent/uptime strings and storage-category labels. Pure so they can be
 * unit tested without rendering the settings screen.
 */

export const HOST_METRICS_POLL_MS = 5_000;

/** Storage category ids with a translated label under settings.host.resources.categories. */
export const KNOWN_STORAGE_CATEGORY_IDS = [
  "logs",
  "agents",
  "projects",
  "worktrees",
  "uploads",
  "project_import_staging",
  "tts_cache",
  "models",
  "daemon_versions",
  "temp",
] as const;
export type KnownStorageCategoryId = (typeof KNOWN_STORAGE_CATEGORY_IDS)[number];

export function isKnownStorageCategoryId(id: string): id is KnownStorageCategoryId {
  return (KNOWN_STORAGE_CATEGORY_IDS as readonly string[]).includes(id);
}

/** used/total clamped to 0..1; null when the total is unknown or zero. */
export function usageFraction(used: number, total: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return Math.min(1, Math.max(0, used / total));
}

/** Percent with no decimals; daemon CPU may exceed 100 (share of one core). */
export function formatPercent(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return `${Math.round(Math.max(0, value))}%`;
}

/** "used / total" in binary units. */
export function formatUsage(used: number, total: number): string {
  return `${formatBytes(used)} / ${formatBytes(total)}`;
}

/** Category size, marked as a lower bound when the daemon's walk was truncated. */
export function formatCategorySize(category: Pick<OwnedStorageCategory, "bytes" | "truncated">) {
  const size = formatBytes(category.bytes);
  return category.truncated ? `≥ ${size}` : size;
}

export interface UptimeParts {
  days: number;
  hours: number;
  minutes: number;
}

export function splitUptime(seconds: number): UptimeParts {
  const total = Math.max(0, Math.floor(seconds));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
  };
}

export type UptimeUnit = "days" | "hours" | "minutes";

/** Non-zero units from the largest down; minutes always shown when nothing else is. */
export function uptimeUnits(seconds: number): { unit: UptimeUnit; count: number }[] {
  const parts = splitUptime(seconds);
  const units: { unit: UptimeUnit; count: number }[] = [];
  if (parts.days > 0) units.push({ unit: "days", count: parts.days });
  if (parts.hours > 0) units.push({ unit: "hours", count: parts.hours });
  if (parts.minutes > 0 || units.length === 0) {
    units.push({ unit: "minutes", count: parts.minutes });
  }
  return units;
}

export function formatLoadAverage(load: readonly number[] | null): string | null {
  if (!load || load.length === 0) return null;
  return load.map((value) => value.toFixed(2)).join(" · ");
}

/** Known categories first in canonical order, then unknown ones by id. */
export function sortStorageCategories(
  categories: readonly OwnedStorageCategory[],
): OwnedStorageCategory[] {
  const rank = (id: string) => {
    const index = (KNOWN_STORAGE_CATEGORY_IDS as readonly string[]).indexOf(id);
    return index === -1 ? KNOWN_STORAGE_CATEGORY_IDS.length : index;
  };
  return [...categories].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

export function totalStorageBytes(categories: readonly OwnedStorageCategory[]): {
  bytes: number;
  truncated: boolean;
} {
  return {
    bytes: categories.reduce((sum, c) => sum + (c.exists ? c.bytes : 0), 0),
    truncated: categories.some((c) => c.truncated),
  };
}

/** Clean is offered only when the daemon says so and there is something to free. */
export function canCleanCategory(category: OwnedStorageCategory): boolean {
  return category.cleanable && category.exists && (category.reclaimableBytes ?? 0) > 0;
}
