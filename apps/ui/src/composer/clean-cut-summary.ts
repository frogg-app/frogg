import type { TFunction } from "i18next";
import type { AgentCleanCutSubagentResult } from "@frogg/protocol/messages";

const SKIP_REASON_KEYS: Record<string, string> = {
  running: "composer.cleanCut.subagents.reasons.running",
  closed: "composer.cleanCut.subagents.reasons.closed",
  "nothing to summarise": "composer.cleanCut.subagents.reasons.empty",
};

function skipReasonLabel(t: TFunction, reason: string | undefined): string {
  if (!reason) return t("composer.cleanCut.subagents.reasons.unknown");
  const key = SKIP_REASON_KEYS[reason];
  return key ? t(key) : reason;
}

export interface CleanCutSubagentSummary {
  text: string;
  hasFailures: boolean;
}

/**
 * COMPAT(agentCleanCutSubagents): added in v1.6.2. One line describing what a
 * clean cut did to the agent's subagents, or null when it had none. Failures
 * name the child and carry the daemon's error text.
 */
export function summarizeCleanCutSubagents(
  t: TFunction,
  subagents: readonly AgentCleanCutSubagentResult[],
): CleanCutSubagentSummary | null {
  if (subagents.length === 0) return null;
  const cut = subagents.filter((item) => item.status === "cut").length;
  const skipped = subagents.filter((item) => item.status === "skipped");
  const failed = subagents.filter((item) => item.status === "failed");
  const parts: string[] = [
    cut > 0
      ? t("composer.cleanCut.subagents.cut", { count: cut })
      : t("composer.cleanCut.subagents.noneCut"),
  ];
  if (skipped.length > 0) {
    const reasons = [...new Set(skipped.map((item) => skipReasonLabel(t, item.reason)))];
    parts.push(
      t("composer.cleanCut.subagents.skipped", {
        count: skipped.length,
        reasons: reasons.join(", "),
      }),
    );
  }
  if (failed.length > 0) {
    const names = failed.map((item) => {
      const title = item.title?.trim() || t("composer.cleanCut.subagents.untitled");
      return item.reason
        ? t("composer.cleanCut.subagents.failedItem", { title, reason: item.reason })
        : title;
    });
    parts.push(
      t("composer.cleanCut.subagents.failed", { count: failed.length, names: names.join(", ") }),
    );
  }
  return { text: parts.join(" · "), hasFailures: failed.length > 0 };
}
