import type { FileExplorerResponse } from "@frogg/protocol/messages";
import { joinDirectoryPath } from "./options";

export type DirectoryListing = NonNullable<FileExplorerResponse["payload"]["directory"]>;
export type DirectoryEntry = DirectoryListing["entries"][number];

export interface BreadcrumbSegment {
  label: string;
  path: string;
}

/** True when typed text names a location rather than a filter for the current folder. */
export function directoryNavigationTarget(currentPath: string, query: string): string | null {
  const typed = query.trim();
  if (!typed) return null;
  if (/^(~(?:[\\/]|$)|\/|\\\\|[A-Za-z]:[\\/])/.test(typed)) return typed;
  if (typed === "." || typed === ".." || /[\\/]/.test(typed)) {
    return joinDirectoryPath(currentPath, typed);
  }
  return null;
}

/** Dot-prefixed entries are hidden from listings unless the user opts in. */
export function isVisibleDirectoryName(name: string, showHidden: boolean): boolean {
  return showHidden || !name.startsWith(".");
}

/**
 * Splits a resolved path into clickable breadcrumb segments, root first. Handles
 * POSIX roots, Windows drive letters, UNC shares and an unresolved `~`.
 */
export function breadcrumbSegments(path: string): BreadcrumbSegment[] {
  const trimmed = path.trim();
  if (!trimmed) return [];
  const windows = /^[A-Za-z]:[\\/]?/.test(trimmed) || trimmed.startsWith("\\\\");
  const separator = windows ? "\\" : "/";
  const parts = trimmed.split(/[\\/]+/).filter(Boolean);
  const segments: BreadcrumbSegment[] = [];
  let current: string;
  if (trimmed.startsWith("\\\\") || trimmed.startsWith("//")) {
    const [server, share, ...rest] = parts;
    if (!server) return [{ label: trimmed, path: trimmed }];
    current = `${separator}${separator}${server}${share ? `${separator}${share}` : ""}`;
    segments.push({ label: current, path: current });
    parts.splice(0, parts.length, ...rest);
  } else if (windows) {
    const drive = parts.shift() ?? "";
    current = `${drive}${separator}`;
    segments.push({ label: drive, path: current });
  } else if (trimmed.startsWith("/")) {
    current = "/";
    segments.push({ label: "/", path: "/" });
  } else {
    current = "";
  }
  for (const part of parts) {
    if (!current) current = part;
    else if (current.endsWith(separator)) current = `${current}${part}`;
    else current = `${current}${separator}${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}

/** Folders first, then files; natural, case-insensitive order within each group. */
export function sortDirectoryEntries(entries: readonly DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
  });
}

export function visibleDirectoryEntries(
  entries: readonly DirectoryEntry[],
  options: { showHidden: boolean; filter: string },
): DirectoryEntry[] {
  const filter = options.filter.trim().toLowerCase();
  const target = filter ? directoryNavigationTarget("/", filter) : null;
  return sortDirectoryEntries(
    entries.filter(
      (entry) =>
        isVisibleDirectoryName(entry.name, options.showHidden) &&
        (target !== null || entry.name.toLowerCase().includes(filter)),
    ),
  );
}

/** Returns an error key when a new folder name cannot be created as a single child. */
export function newDirectoryNameError(name: string): "empty" | "invalid" | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)) return "invalid";
  return null;
}

/**
 * Moves the highlighted entry. `-1` means nothing is highlighted; the first
 * arrow press lands on the first (or last) entry instead of skipping it.
 */
export function moveDirectorySelection(
  index: number,
  count: number,
  direction: "next" | "previous" | "first" | "last",
): number {
  if (count === 0) return -1;
  if (direction === "first") return 0;
  if (direction === "last") return count - 1;
  if (index < 0) return direction === "next" ? 0 : count - 1;
  const next = index + (direction === "next" ? 1 : -1);
  return Math.max(0, Math.min(count - 1, next));
}

export const DOUBLE_ACTIVATION_MS = 400;

/** A second press on the same row within the window counts as a double-click. */
export function isDoubleActivation(
  last: { id: string; at: number } | null,
  id: string,
  now: number,
): boolean {
  return last !== null && last.id === id && now - last.at <= DOUBLE_ACTIVATION_MS;
}
