import { beforeEach, describe, expect, it } from "vitest";

import { seedClaudeModelCatalog } from "../test-utils.js";

import {
  collectWorkflowChildren,
  observeWorkflowChildren,
  parseWorkflowChildMeta,
  parseWorkflowProgressAgents,
  workflowChildSubagentId,
} from "./workflow-children.js";

const WORKFLOW_ID = "toolu_workflow";

function journal(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join("\n");
}

beforeEach(() => {
  seedClaudeModelCatalog();
});

describe("collectWorkflowChildren", () => {
  it("declares a child from its journal start line before any outcome exists", () => {
    const children = collectWorkflowChildren({
      journal: journal([
        { type: "launched" },
        { type: "started", agentId: "a1", label: "server-a", phase: "Fix" },
      ]),
    });

    expect(children).toEqual([{ agentId: "a1", label: "server-a", phase: "Fix", finished: false }]);
  });

  it("marks a child finished and keeps its result once the journal records one", () => {
    const children = collectWorkflowChildren({
      journal: journal([
        { type: "started", agentId: "a1", label: "server-a", phase: "Fix" },
        { type: "result", agentId: "a1", result: "pushed" },
      ]),
    });

    expect(children[0]).toMatchObject({ finished: true, result: "pushed" });
  });

  it("keeps the journal's order, which is the order the children actually started", () => {
    const children = collectWorkflowChildren({
      journal: journal([
        { type: "started", agentId: "second", label: "b" },
        { type: "started", agentId: "first", label: "a" },
      ]),
    });

    expect(children.map((child) => child.agentId)).toEqual(["second", "first"]);
  });

  it("ignores lines it does not understand rather than losing the run", () => {
    const children = collectWorkflowChildren({
      journal: [
        "not json",
        "",
        JSON.stringify({ type: "some_future_line", agentId: "a1" }),
        JSON.stringify({ type: "started", agentId: "a1", label: "server-a" }),
      ].join("\n"),
    });

    expect(children).toHaveLength(1);
  });

  it("only takes sidecar metadata for agents this run launched", () => {
    const children = collectWorkflowChildren({
      journal: journal([{ type: "started", agentId: "mine" }]),
      metaByAgentId: new Map([
        ["mine", { description: "server-a", workflowPhase: "Fix" }],
        ["someone-elses", { description: "other-run" }],
      ]),
    });

    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ agentId: "mine", label: "server-a", phase: "Fix" });
  });

  it("prefers the run summary's per-child facts over the journal's", () => {
    const children = collectWorkflowChildren({
      journal: journal([{ type: "started", agentId: "a1", label: "stale", phase: "Fix" }]),
      progress: parseWorkflowProgressAgents({
        workflowProgress: [
          { type: "workflow_phase", title: "Fix" },
          {
            type: "workflow_agent",
            agentId: "a1",
            label: "server-a",
            phaseTitle: "Fix",
            model: "claude-sonnet-5",
            state: "done",
            tokens: 155_785,
            promptPreview: "Fix the failing server tests",
            lastToolName: "Bash",
            lastToolSummary: "git push",
          },
        ],
      }),
    });

    expect(children[0]).toMatchObject({
      label: "server-a",
      model: "claude-sonnet-5",
      state: "done",
      totalTokens: 155_785,
      description: "Fix the failing server tests",
      lastActivity: "Bash: git push",
    });
  });

  it("reports a child the summary knows about but the journal has not recorded yet", () => {
    const children = collectWorkflowChildren({
      progress: parseWorkflowProgressAgents({
        workflowProgress: [{ type: "workflow_agent", agentId: "a1", label: "server-a" }],
      }),
    });

    expect(children).toEqual([{ agentId: "a1", label: "server-a", finished: false }]);
  });
});

describe("parseWorkflowChildMeta", () => {
  it("reads the sidecar Claude writes beside a workflow child's transcript", () => {
    expect(
      parseWorkflowChildMeta(
        JSON.stringify({
          agentType: "workflow-subagent",
          description: "android",
          workflowPhase: "Fix",
          model: "sonnet",
          spawnDepth: 1,
        }),
      ),
    ).toEqual({
      agentType: "workflow-subagent",
      description: "android",
      workflowPhase: "Fix",
      model: "sonnet",
    });
  });

  it("treats a malformed sidecar as an absent one", () => {
    expect(parseWorkflowChildMeta("{not json")).toBeNull();
    expect(parseWorkflowChildMeta("{}")).toBeNull();
  });
});

describe("observeWorkflowChildren", () => {
  it("names the row by the child's label and points it at the Workflow row", () => {
    const observations = observeWorkflowChildren({
      workflowSubagentId: WORKFLOW_ID,
      children: [
        {
          agentId: "a1",
          label: "server-a",
          phase: "Fix",
          model: "claude-sonnet-5",
          finished: false,
        },
      ],
    });

    expect(observations).toContainEqual({
      kind: "declared",
      id: workflowChildSubagentId(WORKFLOW_ID, "a1"),
      parentId: WORKFLOW_ID,
      title: "server-a",
    });
    // The phase repeats across the fan-out, so it belongs in the subtitle rather than the label.
    expect(observations).toContainEqual({
      kind: "subtitle",
      id: workflowChildSubagentId(WORKFLOW_ID, "a1"),
      subtitle: "Fix · Sonnet 5",
    });
  });

  it("falls back to the agent id when the run named the child nothing", () => {
    const [declared] = observeWorkflowChildren({
      workflowSubagentId: WORKFLOW_ID,
      children: [{ agentId: "a1", finished: false }],
    });

    expect(declared).toMatchObject({ kind: "declared", title: "a1" });
  });

  it("reports an unfinished child as running while its run is still live", () => {
    const observations = observeWorkflowChildren({
      workflowSubagentId: WORKFLOW_ID,
      children: [{ agentId: "a1", finished: false }],
      terminalizeRunning: false,
    });

    expect(observations).toContainEqual(
      expect.objectContaining({ kind: "status", status: "running" }),
    );
  });

  it("terminalizes an unfinished child on replay, where it can never report back", () => {
    const observations = observeWorkflowChildren({
      workflowSubagentId: WORKFLOW_ID,
      children: [{ agentId: "a1", finished: false }],
      terminalizeRunning: true,
    });

    expect(observations).toContainEqual(
      expect.objectContaining({ kind: "status", status: "failed" }),
    );
  });

  it("lets the run summary's state distinguish a failure from a mere stop", () => {
    const observations = observeWorkflowChildren({
      workflowSubagentId: WORKFLOW_ID,
      children: [{ agentId: "a1", finished: true, state: "failed" }],
    });

    expect(observations).toContainEqual(
      expect.objectContaining({ kind: "status", status: "failed" }),
    );
  });

  it("reads an unrecognized state as still working rather than broken", () => {
    const observations = observeWorkflowChildren({
      workflowSubagentId: WORKFLOW_ID,
      children: [{ agentId: "a1", finished: false, state: "some-future-state" }],
      terminalizeRunning: false,
    });

    expect(observations).toContainEqual(
      expect.objectContaining({ kind: "status", status: "running" }),
    );
  });

  it("appends the recorded result to the child's own timeline", () => {
    const observations = observeWorkflowChildren({
      workflowSubagentId: WORKFLOW_ID,
      children: [{ agentId: "a1", finished: true, result: "pushed" }],
    });

    expect(observations).toContainEqual({
      kind: "timeline",
      id: workflowChildSubagentId(WORKFLOW_ID, "a1"),
      item: { type: "assistant_message", text: "pushed" },
    });
  });

  it("does not repeat a result the child's transcript already ends with", () => {
    const observations = observeWorkflowChildren({
      workflowSubagentId: WORKFLOW_ID,
      children: [{ agentId: "a1", finished: true, result: "pushed" }],
      entriesByAgentId: new Map([["a1", [{ type: "assistant" }]]]),
      convertEntry: () => [{ type: "assistant_message", text: "pushed" }],
    });

    const assistantMessages = observations.filter(
      (observation) =>
        observation.kind === "timeline" && observation.item.type === "assistant_message",
    );
    expect(assistantMessages).toHaveLength(1);
  });

  it("scopes a child's id to its workflow, since agent ids repeat across runs", () => {
    expect(workflowChildSubagentId("wf-one", "a1")).not.toBe(
      workflowChildSubagentId("wf-two", "a1"),
    );
  });
});
