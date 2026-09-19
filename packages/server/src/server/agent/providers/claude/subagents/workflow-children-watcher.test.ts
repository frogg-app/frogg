import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentTimelineItem } from "../../../agent-sdk-types.js";
import type { SubagentObservation } from "./observation.js";
import type { ClaudeReplayEntry } from "./replay-source.js";
import { ClaudeWorkflowChildrenWatcher } from "./workflow-children-watcher.js";
import { workflowChildSubagentId } from "./workflow-children.js";

const WORKFLOW_ID = "toolu_workflow";

describe("ClaudeWorkflowChildrenWatcher", () => {
  let sessionDirectory: string;
  let watcher: ClaudeWorkflowChildrenWatcher;

  function runDirectory(runId: string): string {
    return path.join(sessionDirectory, "subagents", "workflows", runId);
  }

  function createRun(runId: string): void {
    mkdirSync(runDirectory(runId), { recursive: true });
  }

  function writeJournal(runId: string, lines: unknown[]): void {
    writeFileSync(
      path.join(runDirectory(runId), "journal.jsonl"),
      `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    );
  }

  function writeTranscript(runId: string, agentId: string, texts: string[]): void {
    writeFileSync(
      path.join(runDirectory(runId), `agent-${agentId}.jsonl`),
      texts.map((text) => `${JSON.stringify({ type: "assistant", text })}\n`).join(""),
    );
  }

  function declared(observations: readonly SubagentObservation[]): SubagentObservation[] {
    return observations.filter((observation) => observation.kind === "declared");
  }

  beforeEach(() => {
    sessionDirectory = mkdtempSync(path.join(os.tmpdir(), "frogg-workflow-watcher-"));
    mkdirSync(path.join(sessionDirectory, "subagents", "workflows"), { recursive: true });
    watcher = new ClaudeWorkflowChildrenWatcher({
      resolveSessionDirectory: () => sessionDirectory,
      parseEntries: (contents) =>
        contents
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line) as ClaudeReplayEntry),
      convertEntry: (entry) =>
        [{ type: "assistant_message", text: String(entry.text) }] as AgentTimelineItem[],
    });
  });

  afterEach(() => {
    rmSync(sessionDirectory, { recursive: true, force: true });
  });

  it("reports nothing while no workflow is being watched", () => {
    createRun("wf_one");
    writeJournal("wf_one", [{ type: "started", agentId: "a1", label: "server-a" }]);

    expect(watcher.poll()).toEqual([]);
    expect(watcher.isWatching).toBe(false);
  });

  it("binds a workflow to the run directory that appears after it started", () => {
    createRun("wf_earlier");
    watcher.track(WORKFLOW_ID);
    createRun("wf_mine");
    writeJournal("wf_mine", [{ type: "started", agentId: "a1", label: "server-a" }]);

    expect(declared(watcher.poll())).toEqual([
      {
        kind: "declared",
        id: workflowChildSubagentId(WORKFLOW_ID, "a1"),
        parentId: WORKFLOW_ID,
        title: "server-a",
      },
    ]);
  });

  it("never binds a run directory that predates the workflow", () => {
    createRun("wf_earlier");
    writeJournal("wf_earlier", [{ type: "started", agentId: "a1", label: "not-mine" }]);
    watcher.track(WORKFLOW_ID);

    expect(watcher.poll()).toEqual([]);
  });

  it("waits rather than guessing when two new run directories are candidates", () => {
    watcher.track(WORKFLOW_ID);
    createRun("wf_one");
    writeJournal("wf_one", [{ type: "started", agentId: "a1", label: "one" }]);
    createRun("wf_two");
    writeJournal("wf_two", [{ type: "started", agentId: "a2", label: "two" }]);

    expect(watcher.poll()).toEqual([]);
  });

  it("gives each of two concurrent workflows its own run once they can be told apart", () => {
    watcher.track("workflow-one");
    createRun("wf_one");
    writeJournal("wf_one", [{ type: "started", agentId: "a1", label: "one" }]);
    // The first binds while it is the only candidate, which is what leaves the second unambiguous.
    watcher.poll();
    watcher.track("workflow-two");
    createRun("wf_two");
    writeJournal("wf_two", [{ type: "started", agentId: "a2", label: "two" }]);

    const parents = declared(watcher.poll()).map((observation) =>
      observation.kind === "declared" ? observation.parentId : null,
    );
    expect(new Set(parents)).toEqual(new Set(["workflow-one", "workflow-two"]));
  });

  it("keeps a bound run across ticks even as later runs appear", () => {
    watcher.track(WORKFLOW_ID);
    createRun("wf_mine");
    writeJournal("wf_mine", [{ type: "started", agentId: "a1", label: "server-a" }]);
    watcher.poll();
    createRun("wf_someone_else");
    writeJournal("wf_someone_else", [{ type: "started", agentId: "zz", label: "other" }]);

    const ids = declared(watcher.poll()).map((observation) => observation.id);
    expect(ids).toEqual([workflowChildSubagentId(WORKFLOW_ID, "a1")]);
  });

  it("broadcasts a status only when it changes", () => {
    watcher.track(WORKFLOW_ID);
    createRun("wf_mine");
    writeJournal("wf_mine", [{ type: "started", agentId: "a1", label: "server-a" }]);

    expect(watcher.poll()).toContainEqual(
      expect.objectContaining({ kind: "status", status: "running" }),
    );
    expect(watcher.poll().filter((observation) => observation.kind === "status")).toEqual([]);

    writeJournal("wf_mine", [
      { type: "started", agentId: "a1", label: "server-a" },
      { type: "result", agentId: "a1", result: "done" },
    ]);
    expect(watcher.poll()).toContainEqual(
      expect.objectContaining({ kind: "status", status: "completed" }),
    );
  });

  it("converts only the transcript lines appended since the last tick", () => {
    watcher.track(WORKFLOW_ID);
    createRun("wf_mine");
    writeJournal("wf_mine", [{ type: "started", agentId: "a1", label: "server-a" }]);
    writeTranscript("wf_mine", "a1", ["first"]);
    const first = watcher.poll().filter((observation) => observation.kind === "timeline");
    expect(first).toHaveLength(1);

    writeTranscript("wf_mine", "a1", ["first", "second"]);
    const second = watcher
      .poll()
      .filter((observation) => observation.kind === "timeline")
      .map((observation) => (observation.kind === "timeline" ? observation.item : null));
    expect(second).toEqual([{ type: "assistant_message", text: "second" }]);
  });

  it("leaves a half-written transcript line for the next tick", () => {
    watcher.track(WORKFLOW_ID);
    createRun("wf_mine");
    writeJournal("wf_mine", [{ type: "started", agentId: "a1", label: "server-a" }]);
    writeFileSync(
      path.join(runDirectory("wf_mine"), "agent-a1.jsonl"),
      `${JSON.stringify({ type: "assistant", text: "complete" })}\n{"type":"assis`,
    );

    const items = watcher
      .poll()
      .filter((observation) => observation.kind === "timeline")
      .map((observation) => (observation.kind === "timeline" ? observation.item : null));
    expect(items).toEqual([{ type: "assistant_message", text: "complete" }]);
  });

  it("reads the run once more on release, so the last children are not left mid-flight", () => {
    watcher.track(WORKFLOW_ID);
    createRun("wf_mine");
    writeJournal("wf_mine", [{ type: "started", agentId: "a1", label: "server-a" }]);
    watcher.poll();
    writeJournal("wf_mine", [
      { type: "started", agentId: "a1", label: "server-a" },
      { type: "result", agentId: "a1", result: "done" },
    ]);

    expect(watcher.release(WORKFLOW_ID)).toContainEqual(
      expect.objectContaining({ kind: "status", status: "completed" }),
    );
    expect(watcher.isWatching).toBe(false);
    expect(watcher.poll()).toEqual([]);
  });

  it("terminalizes a child still running when its workflow is released", () => {
    watcher.track(WORKFLOW_ID);
    createRun("wf_mine");
    writeJournal("wf_mine", [{ type: "started", agentId: "a1", label: "server-a" }]);

    expect(watcher.release(WORKFLOW_ID)).toContainEqual(
      expect.objectContaining({ kind: "status", status: "failed" }),
    );
  });

  it("survives a session with no run directory at all", () => {
    rmSync(path.join(sessionDirectory, "subagents"), { recursive: true, force: true });
    watcher.track(WORKFLOW_ID);

    expect(watcher.poll()).toEqual([]);
  });

  it("forgets every watch on reset, since the offsets do not outlive the session", () => {
    watcher.track(WORKFLOW_ID);
    watcher.reset();

    expect(watcher.isWatching).toBe(false);
  });
});
