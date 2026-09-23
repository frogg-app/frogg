/**
 * "Last seen" for a device list. Deliberately coarse: the exact second a
 * phone last polled is noise, and an absolute timestamp reads as more precise
 * than the daemon's own bookkeeping actually is.
 */
export type LastSeenDescription =
  | { kind: "connected" }
  | { kind: "never" }
  | { kind: "now" }
  | { kind: "minutes"; value: number }
  | { kind: "hours"; value: number }
  | { kind: "days"; value: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function describeLastSeen(
  device: { lastSeenAt: string | null; connected: boolean },
  now: number = Date.now(),
): LastSeenDescription {
  if (device.connected) return { kind: "connected" };
  if (!device.lastSeenAt) return { kind: "never" };
  const seen = Date.parse(device.lastSeenAt);
  if (!Number.isFinite(seen)) return { kind: "never" };
  const elapsed = Math.max(0, now - seen);
  if (elapsed < MINUTE) return { kind: "now" };
  if (elapsed < HOUR) return { kind: "minutes", value: Math.floor(elapsed / MINUTE) };
  if (elapsed < DAY) return { kind: "hours", value: Math.floor(elapsed / HOUR) };
  return { kind: "days", value: Math.floor(elapsed / DAY) };
}

/** The i18n key and interpolation for a description. */
export function lastSeenTranslation(description: LastSeenDescription): {
  key: string;
  options?: { count: number };
} {
  switch (description.kind) {
    case "connected":
      return { key: "deviceAccess.lastSeen.connected" };
    case "never":
      return { key: "deviceAccess.lastSeen.never" };
    case "now":
      return { key: "deviceAccess.lastSeen.justNow" };
    case "minutes":
      return { key: "deviceAccess.lastSeen.minutes", options: { count: description.value } };
    case "hours":
      return { key: "deviceAccess.lastSeen.hours", options: { count: description.value } };
    case "days":
      return { key: "deviceAccess.lastSeen.days", options: { count: description.value } };
  }
}
