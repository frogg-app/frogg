import { useSettings } from "@/hooks/use-settings";
import { DEFAULT_USAGE_METER_PREFERENCES, type UsageMeterPreferences } from "./meter-preferences";

/**
 * The usage-meter preferences, as the meters themselves read them. Kept as its
 * own hook so a meter depends on this one slice rather than re-rendering on
 * every unrelated settings change.
 */
export function useUsageMeterPreferences(): UsageMeterPreferences {
  return useSettings((settings) => settings.usageMeters ?? DEFAULT_USAGE_METER_PREFERENCES);
}
