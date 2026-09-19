import { describe, expect, it } from "vitest";
import {
  SESSION_ID_LENGTH,
  SESSION_ID_PREFIX,
  resolveSessionId,
  toSessionId,
  toSubagentSessionId,
  type SessionIdCandidate,
} from "./session-id.js";

const AGENT_A = "0189d3f1-2c4b-7a61-9f02-3b5c7d8e9f01";
const AGENT_B = "f7c21a90-55de-4b13-8e77-1d2a3b4c5d6e";

const AMBIGUOUS_GLYPHS = /[ILOU]/;

function candidate(agentId: string): SessionIdCandidate {
  return { agentId, sessionId: toSessionId(agentId) };
}

describe("toSessionId", () => {
  it("produces a prefixed, fixed-length ID", () => {
    const id = toSessionId(AGENT_A);
    expect(id.startsWith(SESSION_ID_PREFIX)).toBe(true);
    expect(id).toHaveLength(SESSION_ID_PREFIX.length + SESSION_ID_LENGTH);
  });

  it("encodes the first five bytes of the UUID in Crockford base32", () => {
    // 01 89 d3 f1 2c -> 00000001 10001001 11010011 11110001 00101100
    expect(toSessionId(AGENT_A)).toBe("s_064X7W9C");
  });

  it("is stable and derived, not random", () => {
    expect(toSessionId(AGENT_A)).toBe(toSessionId(AGENT_A));
  });

  it("ignores UUID formatting and case", () => {
    expect(toSessionId(AGENT_A.toUpperCase())).toBe(toSessionId(AGENT_A));
    expect(toSessionId(AGENT_A.replace(/-/g, ""))).toBe(toSessionId(AGENT_A));
    expect(toSessionId(` ${AGENT_A} `)).toBe(toSessionId(AGENT_A));
  });

  it("distinguishes different agents", () => {
    expect(toSessionId(AGENT_A)).not.toBe(toSessionId(AGENT_B));
  });

  it("never emits a glyph Crockford excludes", () => {
    for (let index = 0; index < 500; index += 1) {
      const id = toSessionId(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
      expect(id.slice(SESSION_ID_PREFIX.length)).not.toMatch(AMBIGUOUS_GLYPHS);
    }
  });

  it("still yields an ID for a non-UUID agent id", () => {
    const id = toSessionId("legacy-agent-id");
    expect(id).toHaveLength(SESSION_ID_PREFIX.length + SESSION_ID_LENGTH);
    expect(id.slice(SESSION_ID_PREFIX.length)).not.toMatch(AMBIGUOUS_GLYPHS);
  });
});

describe("toSubagentSessionId", () => {
  it("gives a subagent its own ID, distinct from its parent's", () => {
    expect(toSubagentSessionId(AGENT_A, "sub-1")).not.toBe(toSessionId(AGENT_A));
  });

  it("keys on the composite, so the same subagent id under two parents differs", () => {
    expect(toSubagentSessionId(AGENT_A, "sub-1")).not.toBe(toSubagentSessionId(AGENT_B, "sub-1"));
  });

  it("is stable", () => {
    expect(toSubagentSessionId(AGENT_A, "sub-1")).toBe(toSubagentSessionId(AGENT_A, "sub-1"));
  });

  it("does not collapse a parent/subagent split into the same key", () => {
    // "a\0bc" and "ab\0c" must not hash alike, or two distinct subagents would share an ID.
    expect(toSubagentSessionId("a", "bc")).not.toBe(toSubagentSessionId("ab", "c"));
  });

  it("emits only unambiguous glyphs", () => {
    for (let index = 0; index < 500; index += 1) {
      const id = toSubagentSessionId(AGENT_A, `sub-${index}`);
      expect(id.slice(SESSION_ID_PREFIX.length)).not.toMatch(AMBIGUOUS_GLYPHS);
    }
  });
});

describe("resolveSessionId", () => {
  const candidates = [candidate(AGENT_A), candidate(AGENT_B)];

  it("matches a full UUID", () => {
    const result = resolveSessionId(AGENT_B, candidates);
    expect(result).toEqual({ kind: "match", candidate: candidates[1] });
  });

  it("matches a UUID regardless of dashes or case", () => {
    const result = resolveSessionId(AGENT_B.replace(/-/g, "").toUpperCase(), candidates);
    expect(result).toEqual({ kind: "match", candidate: candidates[1] });
  });

  it("matches a full session ID", () => {
    const result = resolveSessionId(toSessionId(AGENT_A), candidates);
    expect(result).toEqual({ kind: "match", candidate: candidates[0] });
  });

  it("matches case-insensitively and without the prefix", () => {
    const bare = toSessionId(AGENT_A).slice(SESSION_ID_PREFIX.length).toLowerCase();
    expect(resolveSessionId(bare, candidates)).toEqual({ kind: "match", candidate: candidates[0] });
  });

  it("folds the ambiguous glyphs onto the digits they look like", () => {
    const ambiguous = [
      { agentId: "a", sessionId: "s_10ABCDEF" },
      { agentId: "b", sessionId: "s_ZZZZZZZZ" },
    ];
    expect(resolveSessionId("s_lOabcdef", ambiguous)).toEqual({
      kind: "match",
      candidate: ambiguous[0],
    });
  });

  it("matches an unambiguous prefix", () => {
    const only = [candidate(AGENT_A)];
    const prefix = toSessionId(AGENT_A).slice(
      SESSION_ID_PREFIX.length,
      SESSION_ID_PREFIX.length + 3,
    );
    expect(resolveSessionId(prefix, only)).toEqual({ kind: "match", candidate: only[0] });
  });

  it("reports ambiguity instead of guessing", () => {
    const shared = [
      { agentId: "a", sessionId: "s_ABCDEFGH" },
      { agentId: "b", sessionId: "s_ABCDZZZZ" },
    ];
    const result = resolveSessionId("ABC", shared);
    expect(result.kind).toBe("ambiguous");
    expect(result.kind === "ambiguous" && result.candidates).toHaveLength(2);
  });

  it("reports ambiguity when two sessions collide on the same ID", () => {
    const shared = [
      { agentId: "a", sessionId: "s_ABCDEFGH" },
      { agentId: "b", sessionId: "s_ABCDEFGH" },
    ];
    expect(resolveSessionId("s_ABCDEFGH", shared).kind).toBe("ambiguous");
  });

  it("reports not-found for an unknown ID", () => {
    expect(resolveSessionId("s_ZZZZZZZZ", candidates)).toEqual({ kind: "not-found" });
  });

  it("reports not-found for an unknown UUID rather than falling back to prefix matching", () => {
    expect(resolveSessionId("00000000-0000-4000-8000-000000000000", candidates)).toEqual({
      kind: "not-found",
    });
  });

  it("reports not-found for empty input", () => {
    expect(resolveSessionId("   ", candidates)).toEqual({ kind: "not-found" });
    expect(resolveSessionId("s_", candidates)).toEqual({ kind: "not-found" });
  });
});
