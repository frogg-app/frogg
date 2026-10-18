// Pure helpers for clean cuts that move a conversation to another provider or model: what the
// cut marker says about the move, and whether the next move reuses the last cut's summary.
import type { ProviderSnapshotEntry } from "@frogg/protocol/agent-types";
import type { TimelineEntry, TimelineItem } from "../../daemon/types";
import { providerLabel } from "../../util";

type Cut = NonNullable<Extract<TimelineItem, { type: "compaction" }>["cleanCut"]>;

/**
 * True when the timeline ends at a clean cut with no user message after it: that cut's summary
 * still stands, so moving again carries it over and the daemon runs no summariser.
 */
export function endsAtCleanCut(entries: readonly TimelineEntry[] | undefined): boolean {
  if (!entries) return false;
  for (let n = entries.length - 1; n >= 0; n -= 1) {
    const item = entries[n].item;
    if (item.type === "user_message") return false;
    if (item.type === "compaction" && item.cleanCut) return true;
  }
  return false;
}

const side = (provider: string, model: string | undefined) =>
  model ? `${providerLabel(provider)} · ${model}` : providerLabel(provider);

/** "Claude Code · opus → Codex · gpt-5" when the cut changed provider or model, else null. */
export function cutMove(cut: Cut): string | null {
  if (!cut.provider || !cut.previousProvider) return null;
  const providerChanged = cut.provider !== cut.previousProvider;
  const modelChanged = !!cut.model && !!cut.previousModel && cut.model !== cut.previousModel;
  if (!providerChanged && !modelChanged) return null;
  return `${side(cut.previousProvider, cut.previousModel)} → ${side(cut.provider, cut.model)}`;
}

export interface SwitchTarget {
  provider: string;
  label: string;
  models: Array<{ value: string; label: string; hint?: string }>;
  defaultModel: string | null;
}

/** Providers a live session can clean-cut onto: enabled, ready, with models, not its own. */
export function switchTargets(
  entries: readonly ProviderSnapshotEntry[] | undefined,
  current: string,
): SwitchTarget[] {
  return (entries ?? [])
    .filter((e) => e.provider !== current && e.enabled && e.status === "ready" && e.models?.length)
    .map((e) => {
      const models = (e.models ?? []).map((m) => ({
        value: m.id,
        label: m.label,
        hint: m.description,
      }));
      const fallback = e.models?.find((m) => m.isDefault)?.id ?? models[0]?.value ?? null;
      return {
        provider: e.provider,
        label: e.label ?? providerLabel(e.provider),
        models,
        defaultModel: fallback,
      };
    });
}
