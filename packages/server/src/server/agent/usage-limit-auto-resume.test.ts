import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import type { AgentAutoResumeState, AgentManagerEvent } from "./agent-manager.js";
import {
  AUTO_RESUME_GRACE_MS,
  AUTO_RESUME_MAX_ATTEMPTS,
  AUTO_RESUME_PROMPT,
  AUTO_RESUME_UNKNOWN_RESET_MS,
  setupUsageLimitAutoResume,
} from "./usage-limit-auto-resume.js";

const NOW = new Date("2026-09-24T10:00:00.000Z");

function harness(options: { enabled?: boolean; lastReply?: string | null } = {}) {
  let subscriber: ((event: AgentManagerEvent) => void) | null = null;
  const agent = { id: "a1", internal: false, lifecycle: "idle", autoResume: null as unknown };
  const timers: Array<{ callback: () => void; ms: number; cleared: boolean }> = [];
  const resume = vi.fn(async () => undefined);
  const setAgentAutoResume = vi.fn((_id: string, value: AgentAutoResumeState | null) => {
    agent.autoResume = value;
    return true;
  });
  const service = setupUsageLimitAutoResume({
    agentManager: {
      subscribe: (callback: (event: AgentManagerEvent) => void) => {
        subscriber = callback;
        return () => undefined;
      },
      getAgent: () => agent as never,
      setAgentAutoResume,
      getLastAssistantMessage: async () => options.lastReply ?? null,
    } as never,
    isEnabled: () => options.enabled ?? true,
    resume,
    logger: pino({ level: "silent" }),
    now: () => NOW,
    timers: {
      setTimeout: (callback, ms) => {
        const timer = { callback, ms, cleared: false };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (handle) => {
        (handle as { cleared: boolean }).cleared = true;
      },
    },
  });
  const stream = (event: unknown) =>
    subscriber?.({ type: "agent_stream", agentId: "a1", event: event as never });
  return { agent, timers, resume, setAgentAutoResume, service, stream };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("setupUsageLimitAutoResume", () => {
  it("queues a resume a minute after the reported reset and fires it", async () => {
    const h = harness();
    const resetsAt = new Date(NOW.getTime() + 3_600_000);
    h.stream({
      type: "turn_completed",
      provider: "claude",
      usageLimit: { resetsAt: resetsAt.toISOString() },
    });
    await flush();
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].ms).toBe(3_600_000 + AUTO_RESUME_GRACE_MS);
    expect(h.agent.autoResume).toMatchObject({ resetsAt });

    h.timers[0].callback();
    await flush();
    expect(h.resume).toHaveBeenCalledWith("a1", AUTO_RESUME_PROMPT);
    expect(h.agent.autoResume).toBeNull();
  });

  it("falls back to a fixed wait when the reset is unknown", async () => {
    const h = harness();
    h.stream({ type: "turn_failed", provider: "codex", error: "You've hit your usage limit." });
    await flush();
    expect(h.timers[0].ms).toBe(AUTO_RESUME_UNKNOWN_RESET_MS + AUTO_RESUME_GRACE_MS);
  });

  it("reads a short limit notice from the last reply", async () => {
    const h = harness({ lastReply: "You've hit your limit · resets 3pm" });
    h.stream({ type: "turn_completed", provider: "claude" });
    await flush();
    expect(h.timers).toHaveLength(1);
  });

  it("does nothing when disabled", async () => {
    const h = harness({ enabled: false });
    h.stream({ type: "turn_failed", provider: "codex", error: "usage limit reached" });
    await flush();
    expect(h.timers).toHaveLength(0);
  });

  it("drops the timer when the user starts a turn or cancels", async () => {
    const h = harness();
    h.stream({ type: "turn_failed", provider: "codex", error: "usage limit reached" });
    await flush();
    h.stream({ type: "turn_started", provider: "codex" });
    expect(h.timers[0].cleared).toBe(true);
    expect(h.agent.autoResume).toBeNull();
  });

  it("gives up after repeated immediate limits", async () => {
    const h = harness();
    for (let i = 0; i < AUTO_RESUME_MAX_ATTEMPTS + 1; i += 1) {
      h.stream({ type: "turn_failed", provider: "codex", error: "usage limit reached" });
      await flush();
    }
    expect(h.timers).toHaveLength(AUTO_RESUME_MAX_ATTEMPTS);
  });
});
