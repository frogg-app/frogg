import { describe, expect, it, vi } from "vitest";
import type { MutableCleanCutConfig } from "@frogg/protocol/messages";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import {
  maybeAutoCleanCut,
  type AutoCleanCutDeps,
  type AutoCleanCutTrigger,
} from "./auto-clean-cut.js";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function setup(
  options: {
    agent?: Partial<ManagedAgent>;
    settings?: Partial<MutableCleanCutConfig>;
    fail?: boolean;
    unchanged?: boolean;
  } = {},
) {
  const agent = {
    id: "agent-1",
    provider: "claude",
    lifecycle: "idle",
    internal: false,
    persistence: { provider: "claude", sessionId: "s1" },
    ...options.agent,
  } as unknown as ManagedAgent;
  const cleanCut = vi.fn(async () => {
    if (options.fail) throw new Error("summariser failed");
    return options.unchanged ? "unchanged" : "cut";
  });
  const warn = vi.fn();
  const info = vi.fn();
  const settings: MutableCleanCutConfig = {
    auto: { usageLimit: true, daemonRestart: true },
    providers: {},
    ...options.settings,
  };
  const deps: AutoCleanCutDeps = {
    agentManager: { getAgent: () => agent } as unknown as AgentManager,
    providerSnapshotManager: { listProviders: async () => [] },
    logger: { info, warn },
    getCleanCutSettings: () => settings,
    now: () => NOW,
    cleanCut: cleanCut as unknown as AutoCleanCutDeps["cleanCut"],
  };
  return { deps, cleanCut, warn, info };
}

const run = (
  deps: AutoCleanCutDeps,
  lastProviderTurnAt: Date | null,
  trigger: AutoCleanCutTrigger = "usage_limit",
) => maybeAutoCleanCut(deps, { agentId: "agent-1", lastProviderTurnAt, trigger });
const MINUTE = 60 * 1000;

describe("maybeAutoCleanCut", () => {
  it("cuts with the cold-cache reason once the provider's cache TTL has passed", async () => {
    const { deps, cleanCut } = setup();
    await expect(run(deps, new Date(NOW - HOUR - 1))).resolves.toBe("cut");
    expect(cleanCut).toHaveBeenCalledWith(deps, {
      agentId: "agent-1",
      target: {},
      reason: "cold-cache",
    });
  });

  it("leaves a warm cache alone", async () => {
    const { deps, cleanCut } = setup();
    await expect(run(deps, new Date(NOW - HOUR))).resolves.toBe("warm");
    expect(cleanCut).not.toHaveBeenCalled();
  });

  it("does not cut providers without a known cache TTL", async () => {
    const { deps, cleanCut } = setup({ agent: { provider: "copilot" } });
    await expect(run(deps, new Date(NOW - 10 * HOUR))).resolves.toBe("unknown");
    expect(cleanCut).not.toHaveBeenCalled();
  });

  it("does not cut without a last-turn time", async () => {
    const { deps, cleanCut } = setup();
    await expect(run(deps, null)).resolves.toBe("unknown");
    expect(cleanCut).not.toHaveBeenCalled();
  });

  it("honours each trigger's switch on its own", async () => {
    const { deps, cleanCut } = setup({
      settings: { auto: { usageLimit: false, daemonRestart: true } },
    });
    await expect(run(deps, new Date(NOW - 10 * HOUR), "usage_limit")).resolves.toBe("disabled");
    expect(cleanCut).not.toHaveBeenCalled();
    await expect(run(deps, new Date(NOW - 10 * HOUR), "daemon_restart")).resolves.toBe("cut");
  });

  it("uses the global idle threshold in place of the cache TTL", async () => {
    const { deps } = setup({ settings: { idleThresholdMinutes: 15 } });
    await expect(run(deps, new Date(NOW - 16 * MINUTE))).resolves.toBe("cut");
    await expect(run(deps, new Date(NOW - 15 * MINUTE))).resolves.toBe("warm");
  });

  it("lets a provider threshold win over the global one", async () => {
    const { deps } = setup({
      settings: {
        idleThresholdMinutes: 15,
        providers: { claude: { idleThresholdMinutes: 180 } },
      },
    });
    await expect(run(deps, new Date(NOW - 2 * HOUR))).resolves.toBe("warm");
    await expect(run(deps, new Date(NOW - 3 * HOUR - 1))).resolves.toBe("cut");
  });

  it("cuts a provider with no known cache TTL only once it has its own threshold", async () => {
    const agent = { provider: "copilot" } as Partial<ManagedAgent>;
    const global = setup({ agent, settings: { idleThresholdMinutes: 15 } });
    await expect(run(global.deps, new Date(NOW - 10 * HOUR))).resolves.toBe("unknown");
    const own = setup({
      agent,
      settings: { providers: { copilot: { idleThresholdMinutes: 30 } } },
    });
    await expect(run(own.deps, new Date(NOW - 31 * MINUTE))).resolves.toBe("cut");
  });

  it("logs the outcome and reason of every decision", async () => {
    const { deps, info } = setup();
    await run(deps, new Date(NOW - 31 * MINUTE));
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        trigger: "usage_limit",
        outcome: "warm",
        reason: "idle_within_threshold",
        idleMinutes: 31,
        thresholdMinutes: 60,
      }),
      "Automatic clean cut: warm",
    );
  });

  it("skips agents with no provider conversation or a running turn", async () => {
    for (const agent of [{ persistence: null }, { lifecycle: "running" }]) {
      const { deps, cleanCut } = setup({
        agent: agent as unknown as Partial<ManagedAgent>,
      });
      await expect(run(deps, new Date(NOW - 10 * HOUR))).resolves.toBe("skipped");
      expect(cleanCut).not.toHaveBeenCalled();
    }
  });

  it("swallows a failed cut so the caller resumes normally", async () => {
    const { deps, warn } = setup({ fail: true });
    await expect(run(deps, new Date(NOW - 10 * HOUR))).resolves.toBe("failed");
    expect(warn).toHaveBeenCalled();
  });

  it("reports a no-op cut as unchanged rather than cut", async () => {
    const { deps, cleanCut } = setup({ unchanged: true });
    await expect(run(deps, new Date(NOW - 10 * HOUR))).resolves.toBe("unchanged");
    expect(cleanCut).toHaveBeenCalled();
  });
});
