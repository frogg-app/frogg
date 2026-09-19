import { describe, expect, it } from "vitest";
import {
  requestDetachSubagent,
  resolveDetachedSubagentLabel,
  type DetachSubagentDeps,
  type ResolveDetachSubagentDialogInput,
} from "./detach-subagent";

interface RecordedDetach {
  serverId: string;
  agentId: string;
}

interface FakeDetachSubagentEnv {
  deps: DetachSubagentDeps;
  recordedDetaches: RecordedDetach[];
  recordedOpens: RecordedDetach[];
  recordedDetachedLabels: Array<string | null>;
  recordedErrors: unknown[];
}

function createFakeEnv(
  options: {
    initialSubagents?: Array<{ id: string; snapshot: ResolveDetachSubagentDialogInput }>;
  } = {},
): FakeDetachSubagentEnv {
  const subagents = new Map<string, ResolveDetachSubagentDialogInput | undefined>();
  for (const entry of options.initialSubagents ?? []) {
    subagents.set(entry.id, entry.snapshot);
  }
  const recordedDetaches: RecordedDetach[] = [];
  const recordedOpens: RecordedDetach[] = [];
  const recordedDetachedLabels: Array<string | null> = [];
  const recordedErrors: unknown[] = [];

  return {
    recordedDetaches,
    recordedOpens,
    recordedDetachedLabels,
    recordedErrors,
    deps: {
      getSubagent: (id) => subagents.get(id),
      detachAgent: async (input) => {
        recordedDetaches.push(input);
      },
      openDetachedAgent: (input) => {
        recordedOpens.push(input);
      },
      reportDetached: (label) => {
        recordedDetachedLabels.push(label);
      },
      reportError: (error) => {
        recordedErrors.push(error);
      },
    },
  };
}

describe("resolveDetachedSubagentLabel", () => {
  it("uses the subagent title when it is worth showing", () => {
    expect(resolveDetachedSubagentLabel({ title: "Review branch" })).toBe("Review branch");
  });

  it("returns null when the title is a placeholder or empty", () => {
    expect(resolveDetachedSubagentLabel({ title: "New Agent" })).toBeNull();
    expect(resolveDetachedSubagentLabel({ title: "   " })).toBeNull();
    expect(resolveDetachedSubagentLabel({ title: null })).toBeNull();
  });
});

describe("requestDetachSubagent", () => {
  it("detaches immediately, without asking for confirmation", async () => {
    const env = createFakeEnv({
      initialSubagents: [{ id: "child-agent", snapshot: { title: "Review branch" } }],
    });

    await requestDetachSubagent({ serverId: "server-1", subagentId: "child-agent" }, env.deps);

    expect(env.recordedDetaches).toEqual([{ serverId: "server-1", agentId: "child-agent" }]);
  });

  it("opens the detached subagent after detach succeeds", async () => {
    const env = createFakeEnv({
      initialSubagents: [{ id: "child-agent", snapshot: { title: "Review branch" } }],
    });

    await requestDetachSubagent({ serverId: "server-1", subagentId: "child-agent" }, env.deps);

    expect(env.recordedOpens).toEqual([{ serverId: "server-1", agentId: "child-agent" }]);
  });

  it("reports what was detached so the toast can name it", async () => {
    const env = createFakeEnv({
      initialSubagents: [{ id: "child-agent", snapshot: { title: "Review branch" } }],
    });

    await requestDetachSubagent({ serverId: "server-1", subagentId: "child-agent" }, env.deps);

    expect(env.recordedDetachedLabels).toEqual(["Review branch"]);
  });

  it("reports an unnamed detach when the subagent has no displayable title", async () => {
    const env = createFakeEnv({
      initialSubagents: [{ id: "child-agent", snapshot: { title: "New Agent" } }],
    });

    await requestDetachSubagent({ serverId: "server-1", subagentId: "child-agent" }, env.deps);

    expect(env.recordedDetachedLabels).toEqual([null]);
  });

  it("reports detach errors and opens nothing", async () => {
    const env = createFakeEnv({
      initialSubagents: [{ id: "child-agent", snapshot: { title: "Review branch" } }],
    });
    const error = new Error("daemon offline");
    env.deps.detachAgent = async () => {
      throw error;
    };

    await expect(
      requestDetachSubagent({ serverId: "server-1", subagentId: "child-agent" }, env.deps),
    ).resolves.toBeUndefined();
    expect(env.recordedErrors).toEqual([error]);
    expect(env.recordedOpens).toEqual([]);
    expect(env.recordedDetachedLabels).toEqual([]);
  });
});
