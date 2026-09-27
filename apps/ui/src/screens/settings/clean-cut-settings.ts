/**
 * COMPAT(cleanCutSettings): added in v1.6.5, remove after 2027-09-27.
 * Pure helpers behind the host's Clean cut settings section.
 */
import {
  CLEAN_CUT_IDLE_THRESHOLD_MAX_MINUTES,
  type MutableCleanCutConfig,
} from "@frogg/protocol/messages";
import { resolveIdleThresholdMs } from "@frogg/protocol/prompt-cache";

export type ThresholdDraft = { minutes: number | null } | { invalid: true };

/** Empty clears the threshold; otherwise whole minutes within the daemon's bounds. */
export function parseThresholdDraft(draft: string): ThresholdDraft {
  const trimmed = draft.trim();
  if (trimmed === "") return { minutes: null };
  if (!/^\d+$/.test(trimmed)) return { invalid: true };
  const minutes = Number.parseInt(trimmed, 10);
  if (minutes < 1 || minutes > CLEAN_CUT_IDLE_THRESHOLD_MAX_MINUTES) return { invalid: true };
  return { minutes };
}

/**
 * The threshold, in minutes, that applies to a provider without its own
 * override: the global value for providers with a known cache TTL, else that
 * TTL; null when the provider is never cut without an override.
 */
export function inheritedThresholdMinutes(
  provider: string | null,
  settings: Pick<MutableCleanCutConfig, "idleThresholdMinutes"> | null | undefined,
): number | null {
  const ms = resolveIdleThresholdMs(
    provider,
    settings?.idleThresholdMinutes !== undefined
      ? { idleThresholdMinutes: settings.idleThresholdMinutes }
      : {},
  );
  return ms === null ? null : Math.round(ms / 60_000);
}

/**
 * The providers to list for per-provider overrides: every enabled provider,
 * plus any that still has an override but is no longer offered, so it can be
 * cleared.
 */
export function listOverrideProviders(
  available: readonly { id: string; label: string }[],
  settings: Pick<MutableCleanCutConfig, "providers"> | null | undefined,
): { id: string; label: string }[] {
  const listed = new Set(available.map((provider) => provider.id));
  const orphaned = Object.keys(settings?.providers ?? {})
    .filter((id) => !listed.has(id))
    .map((id) => ({ id, label: id }));
  return [...available, ...orphaned];
}
