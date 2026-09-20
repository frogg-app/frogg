import type { ProviderUsageTone } from "./types";

/**
 * How the usage meters keep themselves current and when they change colour.
 *
 * The figures behind a meter come from a provider API the daemon polls on
 * demand, so "how fresh" is a trade between a number that lags and a request
 * made for nobody's benefit. Each trigger is separately switchable because the
 * right answer differs per setup: a desktop left open all day wants the timer,
 * a phone woken to check on a run wants the hover.
 */
export interface UsageMeterPreferences {
  /** Seconds between automatic refreshes while the app has focus; 0 disables the timer. */
  refreshIntervalSeconds: number;
  /** Run the timer above. Off leaves the meters to the event triggers alone. */
  refreshWhileFocused: boolean;
  /** Refresh when a meter's tooltip opens, so a deliberate look is never stale. */
  refreshOnHover: boolean;
  /** Refresh when an agent finishes a turn, the moment the numbers actually moved. */
  refreshOnAgentResponse: boolean;
  /** Spent share above which a meter turns amber. */
  warningThresholdPct: number;
  /** Spent share above which a meter turns red. */
  criticalThresholdPct: number;
  /** Ease the arc and its colour between values instead of snapping. */
  animate: boolean;
}

export const MIN_USAGE_REFRESH_INTERVAL_SECONDS = 5;
export const MAX_USAGE_REFRESH_INTERVAL_SECONDS = 3600;
export const MIN_USAGE_THRESHOLD_PCT = 1;
export const MAX_USAGE_THRESHOLD_PCT = 100;

export const DEFAULT_USAGE_METER_PREFERENCES: UsageMeterPreferences = {
  refreshIntervalSeconds: 30,
  refreshWhileFocused: true,
  refreshOnHover: true,
  refreshOnAgentResponse: true,
  warningThresholdPct: 65,
  criticalThresholdPct: 90,
  animate: true,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * A refresh interval as an integer number of seconds, or 0 for "no timer".
 * Anything unparsable falls back to the default rather than to no refreshing,
 * which would look like the feature silently breaking.
 */
export function parseUsageRefreshInterval(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_USAGE_METER_PREFERENCES.refreshIntervalSeconds;
  if (parsed <= 0) return 0;
  return Math.round(
    clamp(parsed, MIN_USAGE_REFRESH_INTERVAL_SECONDS, MAX_USAGE_REFRESH_INTERVAL_SECONDS),
  );
}

/**
 * Thresholds in range and in order. Amber at or above red would leave red
 * unreachable, so a crossed pair is separated rather than rejected — the
 * settings inputs commit as you type and must never land on a dead state.
 */
export function normalizeUsageThresholds(input: {
  warningThresholdPct: number;
  criticalThresholdPct: number;
}): { warningThresholdPct: number; criticalThresholdPct: number } {
  const warning = clamp(
    Math.round(input.warningThresholdPct),
    MIN_USAGE_THRESHOLD_PCT,
    MAX_USAGE_THRESHOLD_PCT,
  );
  const critical = clamp(
    Math.round(input.criticalThresholdPct),
    MIN_USAGE_THRESHOLD_PCT,
    MAX_USAGE_THRESHOLD_PCT,
  );
  return {
    warningThresholdPct: Math.min(warning, MAX_USAGE_THRESHOLD_PCT - 1),
    criticalThresholdPct: Math.max(critical, Math.min(warning, MAX_USAGE_THRESHOLD_PCT - 1) + 1),
  };
}

export function normalizeUsageMeterPreferences(
  input: Partial<UsageMeterPreferences> | undefined,
): UsageMeterPreferences {
  const merged = { ...DEFAULT_USAGE_METER_PREFERENCES, ...input };
  return {
    ...merged,
    refreshIntervalSeconds: parseUsageRefreshInterval(merged.refreshIntervalSeconds),
    ...normalizeUsageThresholds(merged),
  };
}

/**
 * The tone a spent share reads as. Both thresholds are exclusive: the defaults
 * are "over 65%" and "over 90%", so a window sitting exactly on 90 has not yet
 * earned red.
 */
export function deriveUsageTone(
  pct: number | null | undefined,
  thresholds: Pick<UsageMeterPreferences, "warningThresholdPct" | "criticalThresholdPct">,
): ProviderUsageTone {
  if (pct == null || !Number.isFinite(pct)) return "default";
  if (pct > thresholds.criticalThresholdPct) return "danger";
  if (pct > thresholds.warningThresholdPct) return "warning";
  return "default";
}

/** Milliseconds the arc and its colour take to travel; short enough to read as feedback. */
export const USAGE_METER_TRANSITION_MS = 420;
