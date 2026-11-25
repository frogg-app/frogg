import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attentionKey,
  clearAttention,
  dismissFinish,
  holdFinish,
  NO_HOLD,
  resetAttentionClears,
  showsFinish,
} from "./attention";
import type { Agent } from "./types";

vi.mock("./store", () => ({ getClient: () => null }));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove() {} }) },
}));

const agent = (over: Partial<Agent> = {}): Agent =>
  ({
    id: "a1",
    status: "idle",
    pendingPermissions: [],
    requiresAttention: true,
    attentionReason: "finished",
    attentionTimestamp: "2026-11-25T10:00:00.000Z",
    ...over,
  }) as Agent;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("attentionKey", () => {
  it("keys a raised flag by agent and time", () => {
    expect(attentionKey(agent())).toBe("a1|2026-11-25T10:00:00.000Z");
  });

  it("has nothing to clear when no flag is raised", () => {
    expect(attentionKey(agent({ requiresAttention: false }))).toBeNull();
  });

  it("never clears a permission request", () => {
    expect(attentionKey(agent({ attentionReason: "permission" }))).toBeNull();
    const p = { id: "p" } as Agent["pendingPermissions"][number];
    expect(attentionKey(agent({ pendingPermissions: [p] }))).toBeNull();
  });

  it("clears an error flag (the failed card comes from the status, not the flag)", () => {
    expect(attentionKey(agent({ attentionReason: "error", status: "error" }))).not.toBeNull();
  });
});

describe("clearAttention", () => {
  beforeEach(resetAttentionClears);

  it("sends one clear per raised flag however often it is triggered", () => {
    const clear = vi.fn(() => new Promise<void>(() => {}));
    expect(clearAttention(agent(), clear)).toBe(true);
    expect(clearAttention(agent(), clear)).toBe(false);
    expect(clearAttention(agent(), clear)).toBe(false);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledWith("a1");
  });

  it("clears again when the flag is raised again by a later finish", () => {
    const clear = vi.fn(() => Promise.resolve());
    clearAttention(agent(), clear);
    clearAttention(agent({ attentionTimestamp: "2026-11-25T11:00:00.000Z" }), clear);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it("does nothing for a session without a clearable flag", () => {
    const clear = vi.fn(() => Promise.resolve());
    expect(clearAttention(agent({ requiresAttention: false }), clear)).toBe(false);
    expect(clearAttention(agent({ attentionReason: "permission" }), clear)).toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });

  it("retries after a failed request", async () => {
    const clear = vi.fn(() => Promise.reject(new Error("offline")));
    clearAttention(agent(), clear);
    await flush();
    expect(clearAttention(agent(), clear)).toBe(true);
    expect(clear).toHaveBeenCalledTimes(2);
  });
});

describe("finish card hold", () => {
  const seen = agent({ requiresAttention: false, attentionReason: null });

  it("shows when a finish is raised and stays once the flag is cleared", () => {
    const h = holdFinish(NO_HOLD, agent());
    expect(showsFinish(h, agent())).toBe(true);
    expect(holdFinish(h, seen)).toBe(h);
    expect(showsFinish(h, seen)).toBe(true);
  });

  it("is render-stable: same hold back when nothing changed", () => {
    const h = holdFinish(NO_HOLD, agent());
    expect(holdFinish(h, agent())).toBe(h);
    expect(holdFinish(NO_HOLD, seen)).toBe(NO_HOLD);
  });

  it("folds away once the user moves on, until the next finish", () => {
    const h = dismissFinish(holdFinish(NO_HOLD, agent()));
    expect(showsFinish(h, agent())).toBe(false);
    expect(showsFinish(h, seen)).toBe(false);
    expect(dismissFinish(h)).toBe(h);
    const next = agent({ attentionTimestamp: "2026-11-25T11:00:00.000Z" });
    const h2 = holdFinish(h, next);
    expect(showsFinish(h2, next)).toBe(true);
  });

  it("hides while a turn runs or the session failed", () => {
    const h = holdFinish(NO_HOLD, agent());
    expect(showsFinish(h, agent({ status: "running" }))).toBe(false);
    expect(showsFinish(h, agent({ status: "error" }))).toBe(false);
  });

  it("does not show a session that was already seen when opened", () => {
    expect(showsFinish(holdFinish(NO_HOLD, seen), seen)).toBe(false);
  });

  it("belongs to one session", () => {
    const h = holdFinish(NO_HOLD, agent());
    expect(showsFinish(h, { ...seen, id: "a2" })).toBe(false);
  });
});
