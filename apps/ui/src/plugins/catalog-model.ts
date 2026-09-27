import type { PluginCatalogEntry } from "@frogg/client/internal/daemon-client";

export interface CatalogGroup {
  category: string | null;
  entries: PluginCatalogEntry[];
}

/** Filters by a free-text query over id/name/description/author, then groups by category. */
export function groupCatalog(
  entries: readonly PluginCatalogEntry[],
  query: string,
): CatalogGroup[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? entries.filter((entry) =>
        [entry.id, entry.name, entry.description, entry.author, entry.category]
          .filter((value): value is string => typeof value === "string")
          .some((value) => value.toLowerCase().includes(needle)),
      )
    : entries;
  const groups = new Map<string | null, PluginCatalogEntry[]>();
  for (const entry of matches) {
    const key = entry.category?.trim() || null;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([category, list]) => ({
      category,
      entries: [...list].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => {
      // Uncategorised last.
      if (a.category === null) return 1;
      if (b.category === null) return -1;
      return a.category.localeCompare(b.category);
    });
}
