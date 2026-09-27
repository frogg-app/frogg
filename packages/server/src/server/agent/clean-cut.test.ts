import { describe, expect, it, vi } from "vitest";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import {
  buildCleanCutTranscript,
  prependCleanCutSummary,
  resolveCleanCutSummaryCandidates,
  runCleanCut,
  selectCleanCutItems,
  type CleanCutDeps,
} from "./clean-cut.js";
import { runCleanCutForSubagents } from "./clean-cut-subagents.js";
import { PARENT_AGENT_ID_LABEL } from "@frogg/protocol/agent-labels";

const toolCall: AgentTimelineItem = {
  type: "tool_call",
  callId: "call-1",
  name: "Read",
  status: "completed",
  error: null,
  detail: {
    type: "read",
    filePath: "src/app.ts",
    content: "SECRET FILE CONTENTS",
  },
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
    config: {
      provider: "claude",
      cwd: "/repo",
      model: "opus",
      providerAccountId: "acct-1",
    },
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
      {
        agentConfig: {
          provider: string;
          model: string;
          providerAccountId: string;
        };
      },
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
    await expect(runCleanCut(deps, { agentId: "agent-1", target: {} })).resolves.toBe("unchanged");
    expect(runner).not.toHaveBeenCalled();
    expect(startFreshAgentSession).not.toHaveBeenCalled();
  });

  it("reuses the last summary to move provider when nothing new was said", async () => {
    const { deps, runner, appendTimelineItem } = makeDeps({}, [
      {
        type: "compaction",
        status: "completed",
        cleanCut: { summary: "kept summary" },
      },
    ]);
    await runCleanCut(deps, {
      agentId: "agent-1",
      target: { provider: "codex" },
    });
    expect(runner).not.toHaveBeenCalled();
    expect(appendTimelineItem).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({
        cleanCut: expect.objectContaining({ summary: "kept summary" }),
      }),
    );
  });

  it("tries only the agent's own provider and account, then fails with the reason", async () => {
    const { deps, runner, startFreshAgentSession } = makeDeps({}, conversation);
    runner.mockImplementation(async () => {
      throw new Error("usage limit reached");
    });
    await expect(runCleanCut(deps, { agentId: "agent-1", target: {} })).rejects.toThrow(
      /clean cut summary on claude \(tried haiku, opus\): .*usage limit reached/,
    );
    const configs = runner.mock.calls.map(
      (call) =>
        (
          call as unknown as [
            {
              agentConfig: {
                provider: string;
                model?: string;
                providerAccountId?: string;
              };
            },
          ]
        )[0].agentConfig,
    );
    expect(configs.map((config) => config.model)).toEqual(["haiku", "opus"]);
    for (const config of configs) {
      expect(config).toMatchObject({
        provider: "claude",
        providerAccountId: "acct-1",
      });
    }
    expect(startFreshAgentSession).not.toHaveBeenCalled();
  });

  it("runs a summary model configured on another provider on that provider's default account", async () => {
    const { deps, runner } = makeDeps({}, conversation);
    const listProviders = deps.providerSnapshotManager.listProviders;
    deps.providerSnapshotManager = {
      listProviders: async (options) => [
        ...(await listProviders(options)),
        {
          provider: "codex",
          enabled: true,
          models: [{ id: "gpt-mini", label: "GPT mini" }],
        },
      ],
    } as CleanCutDeps["providerSnapshotManager"];
    deps.getCleanCutSettings = () => ({
      auto: { usageLimit: true, daemonRestart: true },
      summaryModel: { provider: "codex", model: "gpt-mini" },
      providers: {},
    });
    await runCleanCut(deps, { agentId: "agent-1", target: {} });
    const config = (
      runner.mock.calls[0] as unknown as [{ agentConfig: Record<string, unknown> }]
    )[0].agentConfig;
    expect(config).toMatchObject({ provider: "codex", model: "gpt-mini" });
    expect(config).not.toHaveProperty("providerAccountId");
  });

  it("refuses when there is no conversation at all", async () => {
    const { deps } = makeDeps({}, []);
    await expect(runCleanCut(deps, { agentId: "agent-1", target: {} })).rejects.toThrow(
      /no conversation/,
    );
  });
});

describe("resolveCleanCutSummaryCandidates", () => {
  const providers = [
    {
      provider: "claude",
      enabled: true,
      models: [
        { id: "opus", label: "Opus" },
        { id: "sonnet", label: "Sonnet" },
        { id: "haiku", label: "Haiku" },
      ],
    },
    {
      provider: "codex",
      enabled: true,
      models: [
        {
          id: "gpt-5.4-mini",
          label: "GPT-5.4 mini",
          thinkingOptions: [{ id: "low" }, { id: "high" }],
          defaultThinkingOptionId: "high",
        },
      ],
    },
    {
      provider: "gemini",
      enabled: false,
      models: [{ id: "flash", label: "Flash" }],
    },
  ];
  const agent = {
    id: "agent-1",
    cwd: "/repo",
    provider: "claude",
    config: { provider: "claude", cwd: "/repo", model: "opus" },
  } as unknown as ManagedAgent;
  const resolve = (settings: object) => {
    const warn = vi.fn();
    const deps = {
      providerSnapshotManager: { listProviders: async () => providers },
      logger: { info: () => {}, warn },
      getCleanCutSettings: () => ({
        auto: { usageLimit: true, daemonRestart: true },
        providers: {},
        ...settings,
      }),
    } as unknown as CleanCutDeps;
    return { warn, candidates: resolveCleanCutSummaryCandidates(deps, agent) };
  };

  it("tries the provider override, then the global model, then the defaults, then the agent's model", async () => {
    const { candidates } = resolve({
      summaryModel: {
        provider: "codex",
        model: "gpt-5.4-mini",
        thinkingOptionId: "low",
      },
      providers: {
        claude: { summaryModel: { provider: "claude", model: "sonnet" } },
      },
    });
    await expect(candidates).resolves.toEqual([
      { provider: "claude", model: "sonnet" },
      { provider: "codex", model: "gpt-5.4-mini", thinkingOptionId: "low" },
      { provider: "claude", model: "haiku" },
      { provider: "claude", model: "opus" },
    ]);
  });

  it("falls back to the substring list and the agent's model with nothing configured", async () => {
    await expect(resolve({}).candidates).resolves.toEqual([
      { provider: "claude", model: "haiku" },
      { provider: "claude", model: "opus" },
    ]);
  });

  it("skips and logs a configured model its provider does not offer", async () => {
    const { candidates, warn } = resolve({
      summaryModel: { provider: "gemini", model: "flash" },
      providers: {
        claude: { summaryModel: { provider: "claude", model: "retired" } },
      },
    });
    await expect(candidates).resolves.toEqual([
      { provider: "claude", model: "haiku" },
      { provider: "claude", model: "opus" },
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ source: "provider", reason: "model_missing" }),
      expect.any(String),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "global",
        reason: "provider_disabled",
      }),
      expect.any(String),
    );
  });

  it("does not repeat a configured model the defaults would also pick", async () => {
    await expect(
      resolve({ summaryModel: { provider: "claude", model: "haiku" } }).candidates,
    ).resolves.toEqual([
      { provider: "claude", model: "haiku" },
      { provider: "claude", model: "opus" },
    ]);
  });
});

describe("runCleanCutForSubagents", () => {
  function child(id: string, parent: string, extra: Partial<ManagedAgent> = {}) {
    return {
      id,
      provider: "claude",
      cwd: `/worktrees/${id}`,
      lifecycle: "idle",
      createdAt: new Date(id.length),
      labels: { [PARENT_AGENT_ID_LABEL]: parent },
      config: {
        provider: "claude",
        cwd: `/worktrees/${id}`,
        model: "opus",
        title: id,
      },
      persistence: { provider: "claude", sessionId: `${id}-session` },
      ...extra,
    } as unknown as ManagedAgent;
  }

  function makeTree(agents: ManagedAgent[], timelines: Record<string, AgentTimelineItem[]>) {
    const byId = new Map(agents.map((agent) => [agent.id, agent]));
    const startFreshAgentSession = vi.fn(async (id: string) => {
      if (id === "broken") throw new Error("provider down");
      return byId.get(id);
    });
    const appendTimelineItem = vi.fn(async () => ({ seq: 1, epoch: "e" }));
    const runner = vi.fn(async () => ({ summary: "child summary" }));
    const deps: CleanCutDeps = {
      agentManager: {
        listAgents: () => agents,
        getAgent: (id: string) => byId.get(id) ?? null,
        getTimeline: (id: string) => timelines[id] ?? [],
        getProviderAvailability: async () => ({ available: true, error: null }),
        startFreshAgentSession,
        appendTimelineItem,
      } as unknown as AgentManager,
      providerSnapshotManager: {
        listProviders: async () => [
          {
            provider: "claude",
            enabled: true,
            models: [{ id: "haiku", label: "Haiku" }],
          },
        ],
      } as unknown as CleanCutDeps["providerSnapshotManager"],
      logger: { info: () => {}, warn: () => {} },
      runner: runner as unknown as CleanCutDeps["runner"],
    };
    return { deps, startFreshAgentSession, appendTimelineItem, runner };
  }

  it("cuts idle descendants on their own provider, skips running ones, reports failures", async () => {
    const agents = [
      child("idle", "root"),
      child("busy", "root", { lifecycle: "running" }),
      child("grandchild", "busy"),
      child("empty", "root"),
      child("broken", "root"),
      child("stranger", "other-root"),
    ];
    const timelines = {
      idle: conversation,
      busy: conversation,
      grandchild: conversation,
      broken: conversation,
      stranger: conversation,
    };
    const { deps, startFreshAgentSession, appendTimelineItem } = makeTree(agents, timelines);
    const results = await runCleanCutForSubagents(deps, "root");

    expect(
      results.map(({ agentId, status, reason }) => ({
        agentId,
        status,
        reason,
      })),
    ).toEqual([
      { agentId: "idle", status: "cut", reason: undefined },
      { agentId: "busy", status: "skipped", reason: "running" },
      { agentId: "empty", status: "skipped", reason: "nothing to summarise" },
      { agentId: "broken", status: "failed", reason: "provider down" },
      { agentId: "grandchild", status: "cut", reason: undefined },
    ]);
    const cutIds = startFreshAgentSession.mock.calls.map((call) => call[0]);
    expect(cutIds).not.toContain("busy");
    expect(cutIds).not.toContain("stranger");
    // Children keep their own provider and model: the parent's target is not applied.
    expect(startFreshAgentSession).toHaveBeenCalledWith("idle", {});
    expect(appendTimelineItem).toHaveBeenCalledWith(
      "grandchild",
      expect.objectContaining({
        cleanCut: expect.objectContaining({
          summary: "child summary",
          previousSessionId: "grandchild-session",
        }),
      }),
    );
  });

  it("summarises each child from its own timeline", async () => {
    const { deps, runner } = makeTree([child("a", "root")], {
      a: [{ type: "user_message", text: "child-only request" }],
      root: [{ type: "user_message", text: "parent request" }],
    });
    await runCleanCutForSubagents(deps, "root");
    const prompt = (runner.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain("child-only request");
    expect(prompt).not.toContain("parent request");
  });

  it("loads, cuts and unloads children stored on disk but not in memory", async () => {
    const loaded = child("loaded", "root");
    const onDisk = child("on-disk", "root");
    const deeper = child("deeper", "on-disk");
    const { deps, startFreshAgentSession } = makeTree([loaded, onDisk, deeper], {
      loaded: conversation,
      "on-disk": conversation,
      deeper: [],
    });
    const inMemory = new Map<string, ManagedAgent>([["loaded", loaded]]);
    deps.agentManager.listAgents = (() => [...inMemory.values()]) as never;
    deps.agentManager.getAgent = ((id: string) => inMemory.get(id) ?? null) as never;
    const stored: Record<string, ManagedAgent[]> = {
      root: [onDisk],
      "on-disk": [deeper],
    };
    const unloadAgent = vi.fn(async (id: string) => {
      inMemory.delete(id);
    });
    const results = await runCleanCutForSubagents(
      {
        ...deps,
        listStoredChildren: async (parent) =>
          (stored[parent] ?? []).map((agent) => ({
            id: agent.id,
            title: agent.id,
            createdAt: agent.createdAt,
          })),
        loadAgent: async (id) => {
          const agent = [onDisk, deeper].find((candidate) => candidate.id === id)!;
          inMemory.set(id, agent);
          return agent;
        },
        unloadAgent,
      },
      "root",
    );
    expect(results.map(({ agentId, status }) => ({ agentId, status }))).toEqual([
      { agentId: "loaded", status: "cut" },
      { agentId: "on-disk", status: "cut" },
      { agentId: "deeper", status: "skipped" },
    ]);
    expect(startFreshAgentSession.mock.calls.map((call) => call[0])).toEqual(["loaded", "on-disk"]);
    // Only the children loaded for the cut are unloaded again.
    expect(unloadAgent.mock.calls.map((call) => call[0])).toEqual(["on-disk", "deeper"]);
    expect([...inMemory.keys()]).toEqual(["loaded"]);
  });
});
