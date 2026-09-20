import { describe, expect, it } from "vitest";

import {
  resolveStaleContextWarning,
  STALE_CONTEXT_IDLE_MS,
  type StaleContextInput,
} from "./stale-context";

const NOW = new Date("2026-09-19T12:00:00.000Z").getTime();

function input(overrides: Partial<StaleContextInput> = {}): StaleContextInput {
  return {
    provider: "claude",
    contextTokens: 42_000,
    hasConversation: true,
    lastActivityAt: new Date(NOW - STALE_CONTEXT_IDLE_MS - 1),
    isComposing: true,
    now: NOW,
    ...overrides,
  };
}

describe("resolveStaleContextWarning", () => {
  it("warns with the context that is about to be re-sent", () => {
    expect(resolveStaleContextWarning(input())).toEqual({ tokens: 42_000 });
  });

  it("stays quiet until the user actually starts typing", () => {
    expect(resolveStaleContextWarning(input({ isComposing: false }))).toBeNull();
  });

  it("stays quiet inside the cache window, and at its exact edge", () => {
    expect(
      resolveStaleContextWarning(input({ lastActivityAt: new Date(NOW - 60_000) })),
    ).toBeNull();
    expect(
      resolveStaleContextWarning(input({ lastActivityAt: new Date(NOW - STALE_CONTEXT_IDLE_MS) })),
    ).toBeNull();
  });

  it("stays quiet for providers whose cache lifetime this rule does not describe", () => {
    expect(resolveStaleContextWarning(input({ provider: "codex" }))).toBeNull();
    expect(resolveStaleContextWarning(input({ provider: null }))).toBeNull();
  });

  it("stays quiet when there is no context to re-send", () => {
    // The ordinary first message: it costs what it costs, and no cache was lost.
    expect(
      resolveStaleContextWarning(input({ contextTokens: null, hasConversation: false })),
    ).toBeNull();
    expect(resolveStaleContextWarning(input({ contextTokens: 0 }))).toBeNull();
  });

  it("warns without a figure when the conversation's size was never reported", () => {
    // A resumed agent, or one whose daemon restarted: the context is there to be
    // re-sent, only its size is unknown.
    expect(resolveStaleContextWarning(input({ contextTokens: null }))).toEqual({
      tokens: null,
    });
  });

  it("stays quiet when the conversation has no activity stamp at all", () => {
    expect(resolveStaleContextWarning(input({ lastActivityAt: null }))).toBeNull();
  });

  it("treats a future activity stamp as fresh rather than as very stale", () => {
    // Daemon and client clocks disagree; that is not an idle conversation.
    expect(resolveStaleContextWarning(input({ lastActivityAt: new Date(NOW + 5_000) }))).toBeNull();
  });
});
