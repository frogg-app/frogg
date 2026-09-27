import { describe, expect, it, vi } from "vitest";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import {
  buildCleanCutTranscript,
  prependCleanCutSummary,
  runCleanCut,
  selectCleanCutItems,
  type CleanCutDeps,
} from "./clean-cut.js";

const toolCall: AgentTimelineItem = {
  type: "tool_call",
  callId: "call-1",
  name: "Read",
  status: "completed",
  error: null,
  detail: { type: "read", filePath: "src/app.ts", content: "SECRET FILE CONTENTS" },
} as AgentTimelineItem;

const conversation: AgentTimelineItem[] = [
  { type: "user_message", text: "Fix the login bug" },
  { type: "reasoning", text: "PRIVATE THINKING" },
  toolCall,
  { type: "assistant_message", text: "Fixed it in src/app.ts" },
];

describe("buildCleanCutTranscript", () => {
  it("keeps messages and tool calls but not tool output or reasoning", () => {
    const transcript = buildCleanCutTranscript(conversation);
    expect(transcript).toContain("[User] Fix the login bug");
    expect(transcript).toContain("[Assistant] Fixed it in src/app.ts");
    expect(transcript).toContain("src/app.ts");
    expect(transcript).not.toContain("SECRET FILE CONTENTS");
    expect(transcript).not.toContain("PRIVATE THINKING");
  });

  it("starts from the previous clean cut and carries its summary forward", () => {
    const items: AgentTimelineItem[] = [
      { type: "user_message", text: "old request" },
      {
        type: "compaction",
        status: "completed",
        trigger: "manual",
        cleanCut: { summary: "Earlier: set up the repo" },
      },
      { type: "user_message", text: "new request" },
    ];
    expect(selectCleanCutItems(items)).toHaveLength(2);
    const transcript = buildCleanCutTranscript(items);
    expect(transcript).not.toContain("old request");
    expect(transcript).toContain("Earlier: set up the repo");
    expect(transcript).toContain("[User] new request");
  });
});

describe("prependCleanCutSummary", () => {
  it("puts the summary ahead of a text prompt", () => {
    const prompt = prependCleanCutSummary("carry on", "the summary");
    expect(typeof prompt).toBe("string");
    expect(prompt as string).toMatch(/<clean_cut_summary>[\s\S]*the summary[\s\S]*carry on$/);
  });

  it("prepends a text block to a structured prompt", () => {
    const prompt = prependCleanCutSummary([{ type: "text", text: "carry on" }], "the summary");
    expect(Array.isArray(prompt)).toBe(true);
    expect((prompt as { text: string }[])[0].text).toContain("the summary");
    expect((prompt as { text: string }[])[1].text).toBe("carry on");
  });
});

function makeDeps(agent: Partial<ManagedAgent>, timeline: AgentTimelineItem[]) {
  const managed = {
    id: "agent-1",
    provider: "claude",
    cwd: "/repo",
    lifecycle: "idle",
    config: { provider: "claude", cwd: "/repo", model: "opus", providerAccountId: "acct-1" },
    persistence: { provider: "claude", sessionId: "old-session" },
    ...agent,
  } as unknown as ManagedAgent;
  const startFreshAgentSession = vi.fn(async () => ({
    ...managed,
    provider: "codex",
    config: { provider: "codex", cwd: "/repo", model: "gpt" },
  }));
  const appendTimelineItem = vi.fn(async () => ({ seq: 1, epoch: "e" }));
  const manager = {
    getAgent: () => managed,
    getTimeline: () => timeline,
    getProviderAvailability: async () => ({ available: true, error: null }),
    startFreshAgentSession,
    appendTimelineItem,
  } as unknown as AgentManager;
  const runner = vi.fn(async () => ({ summary: "  The summary  " }));
  const deps: CleanCutDeps = {
    agentManager: manager,
    providerSnapshotManager: {
      listProviders: async () => [
        {
          provider: "claude",
          enabled: true,
          models: [
            { id: "opus", label: "Opus" },
            { id: "haiku", label: "Haiku" },
          ],
        },
      ],
    } as unknown as CleanCutDeps["providerSnapshotManager"],
    readDaemonConfig: () => null,
    logger: { info: () => {}, warn: () => {} },
    runner: runner as unknown as CleanCutDeps["runner"],
  };
  return { deps, runner, startFreshAgentSession, appendTimelineItem };
}

describe("runCleanCut", () => {
  it("summarises on the cheapest same-provider model, restarts, then records the marker", async () => {
    const { deps, runner, startFreshAgentSession, appendTimelineItem } = makeDeps({}, conversation);
    await runCleanCut(deps, {
      agentId: "agent-1",
      target: { provider: "codex", model: "gpt" },
    });

    const firstCall = runner.mock.calls[0] as unknown as [
      { agentConfig: { provider: string; model: string; providerAccountId: string } },
    ];
    expect(firstCall[0].agentConfig).toMatchObject({
      provider: "claude",
      model: "haiku",
      providerAccountId: "acct-1",
    });
    expect(startFreshAgentSession).toHaveBeenCalledWith("agent-1", {
      provider: "codex",
      model: "gpt",
    });
    expect(appendTimelineItem).toHaveBeenCalledWith("agent-1", {
      type: "compaction",
      status: "completed",
      trigger: "manual",
      cleanCut: {
        summary: "The summary",
        previousSessionId: "old-session",
        previousProvider: "claude",
        previousModel: "opus",
        provider: "codex",
        model: "gpt",
        summaryModel: "haiku",
        reason: "manual",
      },
    });
  });

  it("refuses while the agent is running", async () => {
    const { deps, startFreshAgentSession } = makeDeps({ lifecycle: "running" }, conversation);
    await expect(runCleanCut(deps, { agentId: "agent-1", target: {} })).rejects.toThrow(
      /finish its turn/,
    );
    expect(startFreshAgentSession).not.toHaveBeenCalled();
  });

  it("does nothing when nothing has happened since the last cut and the target is unchanged", async () => {
    const { deps, runner, startFreshAgentSession } = makeDeps({}, [
      { type: "compaction", status: "completed", cleanCut: { summary: "s" } },
    ]);
    await runCleanCut(deps, { agentId: "agent-1", target: {} });
    expect(runner).not.toHaveBeenCalled();
    expect(startFreshAgentSession).not.toHaveBeenCalled();
  });

  it("reuses the last summary to move provider when nothing new was said", async () => {
    const { deps, runner, appendTimelineItem } = makeDeps({}, [
      { type: "compaction", status: "completed", cleanCut: { summary: "kept summary" } },
    ]);
    await runCleanCut(deps, { agentId: "agent-1", target: { provider: "codex" } });
    expect(runner).not.toHaveBeenCalled();
    expect(appendTimelineItem).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ cleanCut: expect.objectContaining({ summary: "kept summary" }) }),
    );
  });

  it("refuses when there is no conversation at all", async () => {
    const { deps } = makeDeps({}, []);
    await expect(runCleanCut(deps, { agentId: "agent-1", target: {} })).rejects.toThrow(
      /no conversation/,
    );
  });
});
