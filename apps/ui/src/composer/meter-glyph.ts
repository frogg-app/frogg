/**
 * The single character a meter ring carries in its middle. The rings are 16px, so this is one
 * character or nothing: enough to tell the session window from the weekly one at a glance,
 * with the tooltip carrying the full label.
 */

/** The context window's ring. */
export const CONTEXT_METER_GLYPH = "C";

const KNOWN_WINDOW_GLYPHS: ReadonlyArray<{ match: RegExp; glyph: string }> = [
  // Claude reports `five_hour`, Codex `session`, and both mean the same rolling few hours.
  // The glyph names the window rather than its length: a digit read as a count of something
  // rather than as "the five-hour one", and the length is the provider's to change anyway.
  { match: /five[_-]?hour|5h|session/i, glyph: "S" },
  { match: /week/i, glyph: "W" },
  { match: /month/i, glyph: "M" },
  { match: /day|daily/i, glyph: "D" },
];

/**
 * A window's glyph, from its id first and its label second — the id is the stable machine name,
 * the label is what a provider we have no rule for calls it. Anything unrecognised falls back to
 * the first letter of the label, which is still a stable way to tell two rings apart even when
 * it says nothing about the window's length.
 */
export function resolveWindowGlyph(window: { id: string; label: string }): string {
  for (const { match, glyph } of KNOWN_WINDOW_GLYPHS) {
    if (match.test(window.id) || match.test(window.label)) return glyph;
  }
  const initial = window.label.trim().charAt(0);
  return initial ? initial.toUpperCase() : "?";
}
