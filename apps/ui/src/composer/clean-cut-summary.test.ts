import { beforeAll, describe, expect, it } from "vitest";
import type { AgentCleanCutSubagentResult } from "@frogg/protocol/messages";
import { i18n } from "@/localisation/i18next";
import { summarizeCleanCutSubagents } from "./clean-cut-summary";

function child(
  overrides: Partial<AgentCleanCutSubagentResult> & Pick<AgentCleanCutSubagentResult, "status">,
): AgentCleanCutSubagentResult {
  return { agentId: "a", parentAgentId: "p", title: "Child", ...overrides };
}

describe("summarizeCleanCutSubagents", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  it("returns null without subagents, as older daemons send", () => {
    expect(summarizeCleanCutSubagents(i18n.t, [])).toBeNull();
  });

  it("counts cuts and groups skip reasons", () => {
    const summary = summarizeCleanCutSubagents(i18n.t, [
      child({ status: "cut" }),
      child({ status: "cut" }),
      child({ status: "skipped", reason: "running" }),
    ]);
    expect(summary).toEqual({
      text: "Also cut 2 subagents · 1 skipped (running)",
      hasFailures: false,
    });
  });

  it("names failures with the daemon's error and flags them", () => {
    const summary = summarizeCleanCutSubagents(i18n.t, [
      child({ status: "skipped", reason: "closed" }),
      child({ status: "skipped", reason: "nothing to summarise" }),
      child({ status: "failed", title: "Docs", reason: "summary timed out" }),
      child({ status: "failed", title: null }),
    ]);
    expect(summary).toEqual({
      text: "No subagents cut · 2 skipped (closed, nothing new) · 2 failed: Docs (summary timed out), Untitled subagent",
      hasFailures: true,
    });
  });

  it("passes unknown skip reasons through", () => {
    const summary = summarizeCleanCutSubagents(i18n.t, [
      child({ status: "cut" }),
      child({ status: "skipped", reason: "busy" }),
    ]);
    expect(summary?.text).toBe("Also cut 1 subagent · 1 skipped (busy)");
  });
});
