const MINUTE_MS = 60_000;

/**
 * `dd:hh:mm`, dropping leading days and hours when they are zero: `1:02:14`, `2:14`, `14m`.
 * Rounds up so the button never reads zero while the resume is still pending.
 */
export function formatAutoResumeCountdown(remainingMs: number): string {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / MINUTE_MS));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (days > 0) return `${days}:${pad(hours)}:${pad(minutes)}`;
  if (hours > 0) return `${hours}:${pad(minutes)}`;
  return `${minutes}m`;
}

/** Spelled-out form for prose: `1d 2h 14m`, `2h 14m`, `14m`. */
export function formatAutoResumeDuration(remainingMs: number): string {
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / MINUTE_MS));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [days > 0 ? `${days}d` : null, days > 0 || hours > 0 ? `${hours}h` : null];
  return [...parts.filter((part) => part !== null), `${minutes}m`].join(" ");
}
