import { useEasedValue } from "@/hooks/use-eased-value";
import { clampPct } from "./format";
import { USAGE_METER_TRANSITION_MS } from "./meter-preferences";
import { useUsageMeterPreferences } from "./use-meter-preferences";

/**
 * A usage percentage eased between readings, so a figure and the bar or ring
 * beside it travel together instead of the number snapping ahead. Null stays
 * null: a window with no reading shows a dash, not an eased zero.
 */
export function useEasedPct(pct: number | null): number | null {
  const preferences = useUsageMeterPreferences();
  const eased = useEasedValue(clampPct(pct ?? 0), USAGE_METER_TRANSITION_MS, preferences.animate);
  return pct == null ? null : eased;
}
