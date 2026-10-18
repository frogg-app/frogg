import type { ProviderSnapshotEntry } from "@frogg/protocol/agent-types";
import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../../daemon/types";
import { cutMove, endsAtCleanCut, switchTargets } from "./cleanCut";

const entry = (item: unknown) => ({ item }) as TimelineEntry;
const user = entry({ type: "user_message", text: "hi" });
const reply = entry({ type: "assistant_message", text: "ok" });
const cut = entry({ type: "compaction", status: "completed", cleanCut: { summary: "s" } });
const compaction = entry({ type: "compaction", status: "completed", trigger: "auto" });

describe("endsAtCleanCut", () => {
  it("is true when nothing was said since the last clean cut", () => {
    expect(endsAtCleanCut([user, reply, cut])).toBe(true);
  });

  it("is false once a user message follows the cut", () => {
    expect(endsAtCleanCut([user, cut, user, reply])).toBe(false);
  });

  it("ignores provider compactions and timelines without a cut", () => {
    expect(endsAtCleanCut([user, reply, compaction])).toBe(false);
    expect(endsAtCleanCut([])).toBe(false);
    expect(endsAtCleanCut(undefined)).toBe(false);
  });
});

describe("cutMove", () => {
  it("names both sides when the provider changed", () => {
    expect(
      cutMove({
        summary: "s",
        previousProvider: "claude",
        previousModel: "opus",
        provider: "codex",
        model: "gpt-5",
      }),
    ).toBe("Claude Code · opus → Codex · gpt-5");
  });

  it("shows a model change on the same provider", () => {
    expect(
      cutMove({
        summary: "s",
        previousProvider: "claude",
        previousModel: "opus",
        provider: "claude",
        model: "sonnet",
      }),
    ).toBe("Claude Code · opus → Claude Code · sonnet");
  });

  it("is null for a cut that stayed put, or one from an older daemon", () => {
    expect(
      cutMove({ summary: "s", previousProvider: "claude", provider: "claude", model: "opus" }),
    ).toBeNull();
    expect(cutMove({ summary: "s" })).toBeNull();
  });
});

describe("switchTargets", () => {
  const model = (id: string, isDefault?: boolean) => ({
    provider: "codex",
    id,
    label: id,
    ...(isDefault ? { isDefault } : {}),
  });
  const snapshot = [
    { provider: "claude", status: "ready", enabled: true, models: [model("opus")] },
    {
      provider: "codex",
      status: "ready",
      enabled: true,
      label: "Codex",
      models: [model("gpt-5-mini"), model("gpt-5", true)],
    },
    { provider: "gemini", status: "error", enabled: true, models: [model("pro")] },
    { provider: "opencode", status: "ready", enabled: false, models: [model("x")] },
    { provider: "mock", status: "ready", enabled: true, models: [] },
  ] as ProviderSnapshotEntry[];

  it("offers only other ready, enabled providers with models, on their default model", () => {
    const targets = switchTargets(snapshot, "claude");
    expect(targets.map((t) => t.provider)).toEqual(["codex"]);
    expect(targets[0]).toMatchObject({ label: "Codex", defaultModel: "gpt-5" });
  });
});
