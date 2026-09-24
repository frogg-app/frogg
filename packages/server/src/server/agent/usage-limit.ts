import type { UsageLimitSignal } from "./agent-sdk-types.js";

const USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /usage limit (?:reached|exceeded)/i,
  /(?:hit|reached) your (?:usage )?limit/i,
  /\busage_limit_(?:reached|exceeded)\b/i,
  /\busageLimitExceeded\b/,
  /out of (?:extra )?usage/i,
  /rate limit (?:reached|exceeded) for (?:your )?(?:plan|subscription)/i,
];

const MINUTE_MS = 60_000;

/**
 * Recognises provider usage-limit text and pulls a reset time out of it when one is stated.
 * Covers Claude's `Claude AI usage limit reached|<epoch>` and Codex's
 * `You've hit your usage limit … try again at <date>` / `try again in 2 hours 5 minutes`.
 */
export function detectUsageLimitFromText(
  text: string | null | undefined,
  now: Date = new Date(),
): UsageLimitSignal | null {
  if (!text || !USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))) return null;
  const resetsAt = parseResetTime(text, now);
  return { resetsAt: resetsAt ? resetsAt.toISOString() : null };
}

function parseResetTime(text: string, now: Date): Date | null {
  const epoch = text.match(/usage limit reached\|(\d{10,13})/i);
  if (epoch) {
    const value = Number(epoch[1]);
    return new Date(value < 1e12 ? value * 1000 : value);
  }

  const relative = text.match(/(?:try again|resets?) in ([^.\n]+)/i);
  if (relative) {
    const ms = parseDuration(relative[1]);
    if (ms > 0) return new Date(now.getTime() + ms);
  }

  const absolute = text.match(/(?:try again at|resets?(?: at)?) ([^.\n(]+)/i);
  if (absolute) {
    const cleaned = absolute[1].replace(/(\d)(st|nd|rd|th)\b/g, "$1").trim();
    const parsed = Date.parse(cleaned);
    if (Number.isFinite(parsed) && parsed > now.getTime()) return new Date(parsed);
  }
  return null;
}

function parseDuration(input: string): number {
  let total = 0;
  const units: Array<[RegExp, number]> = [
    [/(\d+)\s*d(?:ays?)?\b/i, 24 * 60 * MINUTE_MS],
    [/(\d+)\s*h(?:ours?|rs?)?\b/i, 60 * MINUTE_MS],
    [/(\d+)\s*m(?:in(?:ute)?s?)?\b/i, MINUTE_MS],
    [/(\d+)\s*s(?:ec(?:ond)?s?)?\b/i, 1000],
  ];
  for (const [pattern, unit] of units) {
    const match = input.match(pattern);
    if (match) total += Number(match[1]) * unit;
  }
  return total;
}
