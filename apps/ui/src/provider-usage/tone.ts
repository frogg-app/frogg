import { DEFAULT_USAGE_METER_PREFERENCES, deriveUsageTone } from "./meter-preferences";
import type { ProviderUsageTone } from "./types";

/**
 * The tone for a spent share under the default thresholds. Call sites that can
 * reach the user's own thresholds should use `deriveUsageTone` with them
 * instead; this is for the ones that only ever format a static summary.
 */
export function deriveTone(usedPct: number | null | undefined): ProviderUsageTone {
  return deriveUsageTone(usedPct, DEFAULT_USAGE_METER_PREFERENCES);
}
