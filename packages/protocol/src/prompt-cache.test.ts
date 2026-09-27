import { describe, expect, it } from "vitest";
import { getPromptCacheTtlMs, isPromptCacheCold } from "./prompt-cache.js";

const HOUR = 60 * 60 * 1000;
const NOW = 10 * HOUR;

describe("prompt cache warmth", () => {
  it("knows Claude's hour and nothing else", () => {
    expect(getPromptCacheTtlMs("claude")).toBe(HOUR);
    expect(getPromptCacheTtlMs("codex")).toBeNull();
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
    expect(isPromptCacheCold({ provider: "codex", lastTurnAt: 0, now: NOW })).toBeNull();
    expect(isPromptCacheCold({ provider: "claude", lastTurnAt: null, now: NOW })).toBeNull();
  });
});
