import { describe, expect, it } from "vitest";

import type { AgentUsage } from "@frogg/protocol/agent-types";

import { acceptAgentDirectoryUpdate } from "./agent-directory-update-policy";

interface Entry {
  updatedAt: string;
  lastUsage?: AgentUsage;
}

function entry(updatedAt: string, lastUsage?: AgentUsage): Entry {
  return lastUsage ? { updatedAt, lastUsage } : { updatedAt };
}

const OLD = "2026-09-20T00:00:00.000Z";
const NEW = "2026-09-20T01:00:00.000Z";

describe("acceptAgentDirectoryUpdate", () => {
  it("takes the newer snapshot", () => {
    const incoming = entry(NEW, { contextWindowUsedTokens: 10 });
    expect(acceptAgentDirectoryUpdate(entry(OLD), incoming)).toBe(incoming);
  });

  // COMPAT(persistedAgentUsage): added in v1.5.10.
  it("keeps the known usage when a newer snapshot carries none", () => {
    const current = entry(OLD, { contextWindowUsedTokens: 175_000 });
    expect(acceptAgentDirectoryUpdate(current, entry(NEW))).toEqual({
      updatedAt: NEW,
      lastUsage: { contextWindowUsedTokens: 175_000 },
    });
  });

  it("keeps the current snapshot when the update is stale, taking only fresher usage", () => {
    const current = entry(NEW, { contextWindowUsedTokens: 10 });
    expect(acceptAgentDirectoryUpdate(current, entry(OLD))).toBe(current);
    expect(acceptAgentDirectoryUpdate(current, entry(OLD, { outputTokens: 5 }))).toEqual({
      updatedAt: NEW,
      lastUsage: { outputTokens: 5 },
    });
  });
});
