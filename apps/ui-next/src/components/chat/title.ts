import type { TimelineEntry } from "../../daemon/types";

/** Longest title the daemon accepts (protocol MAX_EXPLICIT_AGENT_TITLE_CHARS). */
const MAX = 200;

/**
 * Until a session is named, the daemon titles it with the first 60 characters of the first
 * prompt line, cut mid-word. When the title is such a prefix, show the whole line instead, so the
 * header fills its width and ellipsises at the edge rather than stopping mid-word.
 */
export function headerTitle(title: string, entries: TimelineEntry[] | undefined): string {
  const t = title.trim();
  if (!t || !entries) return title;
  const first = entries.find((e) => e.item.type === "user_message")?.item;
  if (first?.type !== "user_message") return title;
  const line = first.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean)
    ?.replace(/\s+/g, " ");
  if (!line || line.length <= t.length || !line.startsWith(t)) return title;
  return line.length > MAX ? `${line.slice(0, MAX)}…` : line;
}
