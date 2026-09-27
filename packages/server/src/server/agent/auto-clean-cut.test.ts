import { describe, expect, it, vi } from "vitest";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import { maybeAutoCleanCut, type AutoCleanCutDeps } from "./auto-clean-cut.js";

const NOW = Date.parse("2026-09-27T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function setup(options: { agent?: Partial<ManagedAgent>; enabled?: boolean; fail?: boolean } = {}) {
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
  });
  const warn = vi.fn();
  const deps: AutoCleanCutDeps = {
    agentManager: { getAgent: () => agent } as unknown as AgentManager,
    providerSnapshotManager: { listProviders: async () => [] },
    readDaemonConfig: () => null,
    logger: { info: () => {}, warn },
    isEnabled: () => options.enabled ?? true,
    now: () => NOW,
    cleanCut: cleanCut as unknown as AutoCleanCutDeps["cleanCut"],
  };
  return { deps, cleanCut, warn };
}

const run = (deps: AutoCleanCutDeps, lastProviderTurnAt: Date | null) =>
  maybeAutoCleanCut(deps, { agentId: "agent-1", lastProviderTurnAt, trigger: "usage_limit" });

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
    const { deps, cleanCut } = setup({ agent: { provider: "codex" } });
    await expect(run(deps, new Date(NOW - 10 * HOUR))).resolves.toBe("unknown");
    expect(cleanCut).not.toHaveBeenCalled();
  });

  it("does not cut without a last-turn time", async () => {
    const { deps, cleanCut } = setup();
    await expect(run(deps, null)).resolves.toBe("unknown");
    expect(cleanCut).not.toHaveBeenCalled();
  });

  it("respects the config switch", async () => {
    const { deps, cleanCut } = setup({ enabled: false });
    await expect(run(deps, new Date(NOW - 10 * HOUR))).resolves.toBe("disabled");
    expect(cleanCut).not.toHaveBeenCalled();
  });

  it("skips agents with no provider conversation or a running turn", async () => {
    for (const agent of [{ persistence: null }, { lifecycle: "running" }]) {
      const { deps, cleanCut } = setup({ agent: agent as unknown as Partial<ManagedAgent> });
      await expect(run(deps, new Date(NOW - 10 * HOUR))).resolves.toBe("skipped");
      expect(cleanCut).not.toHaveBeenCalled();
    }
  });

  it("swallows a failed cut so the caller resumes normally", async () => {
    const { deps, warn } = setup({ fail: true });
    await expect(run(deps, new Date(NOW - 10 * HOUR))).resolves.toBe("failed");
    expect(warn).toHaveBeenCalled();
  });
});
