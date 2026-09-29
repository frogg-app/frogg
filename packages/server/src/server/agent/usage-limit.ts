import type { UsageLimitSignal } from "./agent-sdk-types.js";

const USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /usage limit (?:reached|exceeded)/i,
  /(?:hit|reached) your (?:usage |session |weekly )?limit/i,
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

  const clock = parseClockTime(text, now);
  if (clock) return clock;

  const absolute = text.match(/(?:try again at|resets?(?: at)?) ([^.\n(]+)/i);
  if (absolute) {
    const cleaned = absolute[1].replace(/(\d)(st|nd|rd|th)\b/g, "$1").trim();
    const parsed = Date.parse(cleaned);
    if (Number.isFinite(parsed) && parsed > now.getTime()) return new Date(parsed);
  }
  return null;
}

/**
 * Claude's `resets 11:20am (UTC)` / `resets 3pm (Australia/Sydney)`: a wall-clock time in the
 * named zone (UTC when none is given), taken as the next occurrence after `now`.
 */
function parseClockTime(text: string, now: Date): Date | null {
  const match = text.match(
    /resets?(?: at)? (\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*\(([^)]+)\))?/i,
  );
  if (!match) return null;
  let hours = Number(match[1]) % 12;
  if (match[3].toLowerCase() === "pm") hours += 12;
  const minutes = match[2] ? Number(match[2]) : 0;
  if (minutes > 59) return null;
  const offsetMs = zoneOffsetMs(match[4]?.trim() || "UTC", now);
  if (offsetMs === null) return null;
  const local = new Date(now.getTime() + offsetMs);
  let candidate =
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hours, minutes) -
    offsetMs;
  if (candidate <= now.getTime()) candidate += 24 * 60 * MINUTE_MS;
  return new Date(candidate);
}

/** Offset of `timeZone` from UTC at `at`, or null for a zone Intl does not know. */
function zoneOffsetMs(timeZone: string, at: Date): number | null {
  if (/^(?:utc|gmt|z)$/i.test(timeZone)) return 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return null;
  }
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
