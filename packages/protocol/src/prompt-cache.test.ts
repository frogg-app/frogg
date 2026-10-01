import { describe, expect, it } from "vitest";
import { getPromptCacheTtlMs, isPromptCacheCold, resolveIdleThresholdMs } from "./prompt-cache.js";

const HOUR = 60 * 60 * 1000;
const NOW = 10 * HOUR;

describe("prompt cache warmth", () => {
  it("knows Claude's hour and nothing else", () => {
    expect(getPromptCacheTtlMs("claude")).toBe(HOUR);
    expect(getPromptCacheTtlMs("copilot")).toBeNull();
    expect(getPromptCacheTtlMs("toString")).toBeNull();
    expect(getPromptCacheTtlMs(null)).toBeNull();
  });

  it("is cold only past the TTL, and warm for a future stamp", () => {
    const cold = (lastTurnAt: number | Date) =>
      isPromptCacheCold({ provider: "claude", lastTurnAt, now: NOW });
    expect(cold(NOW - HOUR)).toBe(false);
    expect(cold(NOW - HOUR - 1)).toBe(true);
    expect(cold(new Date(NOW + HOUR))).toBe(false);
  });

  it("is unknown without a TTL or a last-turn time", () => {
    expect(isPromptCacheCold({ provider: "copilot", lastTurnAt: 0, now: NOW })).toBeNull();
    expect(isPromptCacheCold({ provider: "claude", lastTurnAt: null, now: NOW })).toBeNull();
  });

  it("resolves the idle threshold: provider override, then global, then TTL", () => {
    const MIN = 60_000;
    const settings = {
      idleThresholdMinutes: 20,
      providers: {
        codex: { idleThresholdMinutes: 90 },
        copilot: { idleThresholdMinutes: 45 },
      },
    };
    expect(resolveIdleThresholdMs("codex", settings)).toBe(90 * MIN);
    expect(resolveIdleThresholdMs("claude", settings)).toBe(20 * MIN);
    expect(resolveIdleThresholdMs("claude", null)).toBe(HOUR);
    // No known TTL: only its own threshold makes it cuttable, never the global one.
    expect(resolveIdleThresholdMs("copilot", settings)).toBe(45 * MIN);
    expect(resolveIdleThresholdMs("opencode", settings)).toBeNull();
    expect(resolveIdleThresholdMs("toString", settings)).toBeNull();
    expect(
      isPromptCacheCold({
        provider: "claude",
        lastTurnAt: NOW - 21 * MIN,
        now: NOW,
        settings,
      }),
    ).toBe(true);
  });
});
