import fs from "node:fs";
import path from "node:path";

import type { AgentTimelineItem } from "../../../agent-sdk-types.js";
import type { SubagentObservation } from "./observation.js";
import type { ClaudeReplayEntry } from "./replay-source.js";
import {
  collectWorkflowChildren,
  observeWorkflowChildren,
  parseWorkflowChildMeta,
  parseWorkflowProgressAgents,
  type ClaudeWorkflowChildMeta,
} from "./workflow-children.js";

/**
 * Watches a live Workflow run's directory so its children appear while they are still working.
 *
 * Claude Code announces a workflow to the SDK stream as one `local_workflow` task and never
 * announces the agents it fans out, so there is no live signal to subscribe to: the run directory
 * is the only place the children exist before the run finishes. This polls it.
 *
 * Polling rather than watching is deliberate. `fs.watch` reports directory churn inconsistently
 * across platforms and filesystems — and this has to work over the network mounts daemons are
 * routinely installed on — while the files involved are a few kilobytes of journal and sidecar.
 * The transcripts, which are not small, are read incrementally from a byte offset, so a tick
 * costs one stat and the bytes actually appended since the last one.
 *
 * Every observation it produces is idempotent under the store's sticky merge except timeline
 * items, which append; those are the one thing it tracks offsets for.
 */

/** Frequent enough to read as live, rare enough that an idle run costs a stat per file. */
export const WORKFLOW_CHILDREN_POLL_INTERVAL_MS = 2_000;

const WORKFLOW_JOURNAL_FILE = "journal.jsonl";
const WORKFLOW_CHILD_META_FILE = /^agent-(.+)\.meta\.json$/;
const WORKFLOW_CHILD_TRANSCRIPT_FILE = /^agent-(.+)\.jsonl$/;

interface WatchedWorkflow {
  /** The Workflow row the children hang beneath. */
  subagentId: string;
  /** Run directories that already existed when this workflow started, so they cannot be its own. */
  preexistingRunIds: ReadonlySet<string>;
  /** Resolved once this workflow is matched to a run directory. */
  runId?: string;
  /** Transcript path -> bytes already converted into timeline items. */
  transcriptOffsets: Map<string, number>;
  /** Last subtitle and status emitted per child, so an unchanged tick broadcasts nothing. */
  lastSubtitleByChildId: Map<string, string>;
  lastStatusByChildId: Map<string, string>;
}

export interface ClaudeWorkflowChildrenWatcherInput {
  /**
   * The Claude session directory holding `subagents/workflows/` and `workflows/`, or null when the
   * session has no resolvable history path yet. Read per tick rather than captured, because the
   * session id is assigned after the first turn starts.
   */
  resolveSessionDirectory: () => string | null;
  parseEntries: (contents: string) => ClaudeReplayEntry[];
  convertEntry: (entry: ClaudeReplayEntry) => AgentTimelineItem[];
}

export class ClaudeWorkflowChildrenWatcher {
  private readonly watched = new Map<string, WatchedWorkflow>();
  private readonly input: ClaudeWorkflowChildrenWatcherInput;

  constructor(input: ClaudeWorkflowChildrenWatcherInput) {
    this.input = input;
  }

  /** Whether any workflow is still being watched, and so whether a timer is still worth running. */
  get isWatching(): boolean {
    return this.watched.size > 0;
  }

  /**
   * Start watching a workflow that has just been declared.
   *
   * The run directory is named after a run id the SDK stream never mentions, so the binding is
   * made by elimination: the directories that already existed belong to earlier runs, and a
   * directory that appears afterwards belongs to a workflow started since. `track` records that
   * baseline; `resolveRunId` binds only when the answer is unambiguous.
   */
  track(workflowSubagentId: string): void {
    if (this.watched.has(workflowSubagentId)) return;
    this.watched.set(workflowSubagentId, {
      subagentId: workflowSubagentId,
      preexistingRunIds: new Set(this.listRunIds()),
      transcriptOffsets: new Map(),
      lastSubtitleByChildId: new Map(),
      lastStatusByChildId: new Map(),
    });
  }

  /**
   * Stop watching a workflow, returning the observations of one final read.
   *
   * The last poll matters: a workflow reports completion on the SDK stream, and the journal lines
   * for its final children land at essentially the same moment. Dropping the watch on the
   * announcement alone would leave those children showing their second-to-last state forever.
   */
  release(workflowSubagentId: string): SubagentObservation[] {
    const watched = this.watched.get(workflowSubagentId);
    if (!watched) return [];
    const observations = this.observeWorkflow(watched, { terminalizeRunning: true });
    this.watched.delete(workflowSubagentId);
    return observations;
  }

  /** Forget every watch. The run directories outlive the session; the offsets into them do not. */
  reset(): void {
    this.watched.clear();
  }

  /** One tick: read each watched run directory and report what changed. */
  poll(): SubagentObservation[] {
    const observations: SubagentObservation[] = [];
    for (const watched of this.watched.values()) {
      observations.push(...this.observeWorkflow(watched, { terminalizeRunning: false }));
    }
    return observations;
  }

  private observeWorkflow(
    watched: WatchedWorkflow,
    options: { terminalizeRunning: boolean },
  ): SubagentObservation[] {
    const runId = this.resolveRunId(watched);
    const sessionDirectory = this.input.resolveSessionDirectory();
    if (!runId || !sessionDirectory) return [];
    const runDirectory = path.join(sessionDirectory, "subagents", "workflows", runId);

    const metaByAgentId = new Map<string, ClaudeWorkflowChildMeta>();
    const entriesByAgentId = new Map<string, ClaudeReplayEntry[]>();
    let journal: string | undefined;

    for (const entry of readDirectory(runDirectory)) {
      if (!entry.isFile()) continue;
      const entryPath = path.join(runDirectory, entry.name);
      if (entry.name === WORKFLOW_JOURNAL_FILE) {
        journal = readFile(entryPath);
        continue;
      }
      const metaMatch = WORKFLOW_CHILD_META_FILE.exec(entry.name);
      if (metaMatch?.[1]) {
        const contents = readFile(entryPath);
        const meta = contents === undefined ? null : parseWorkflowChildMeta(contents);
        if (meta) metaByAgentId.set(metaMatch[1], meta);
        continue;
      }
      const transcriptMatch = WORKFLOW_CHILD_TRANSCRIPT_FILE.exec(entry.name);
      if (!transcriptMatch?.[1]) continue;
      const appended = this.readAppended(watched, entryPath);
      if (appended) entriesByAgentId.set(transcriptMatch[1], this.input.parseEntries(appended));
    }

    const children = collectWorkflowChildren({
      ...(journal === undefined ? {} : { journal }),
      metaByAgentId,
      // Present only once the run has finished and written its summary. Until then the journal
      // and sidecars carry the whole story, which is precisely why they are the live source.
      progress: parseWorkflowProgressAgents(
        readJson(path.join(sessionDirectory, "workflows", `${runId}.json`)),
      ),
    });

    return this.suppressUnchanged(
      watched,
      observeWorkflowChildren({
        workflowSubagentId: watched.subagentId,
        children,
        entriesByAgentId,
        convertEntry: this.input.convertEntry,
        terminalizeRunning: options.terminalizeRunning,
      }),
    );
  }

  /**
   * Drop the subtitle and status observations that repeat what was already sent.
   *
   * The run directory is re-read in full each tick, so without this every child would rebroadcast
   * an identical descriptor to every connected client twice a second. Declarations are left alone:
   * they are cheap, and re-declaring is what lets a client that connected late catch up.
   */
  private suppressUnchanged(
    watched: WatchedWorkflow,
    observations: readonly SubagentObservation[],
  ): SubagentObservation[] {
    return observations.filter((observation) => {
      if (observation.kind === "subtitle") {
        if (watched.lastSubtitleByChildId.get(observation.id) === observation.subtitle)
          return false;
        watched.lastSubtitleByChildId.set(observation.id, observation.subtitle);
        return true;
      }
      if (observation.kind === "status") {
        if (watched.lastStatusByChildId.get(observation.id) === observation.status) return false;
        watched.lastStatusByChildId.set(observation.id, observation.status);
        return true;
      }
      return true;
    });
  }

  /**
   * Bind a watched workflow to the run directory it created, when that is unambiguous.
   *
   * Two workflows started between one tick and the next would each see two candidate directories
   * and neither could tell which is its own. Guessing there would put one run's children under the
   * other's row permanently, so this waits instead: the ambiguity resolves as soon as one of them
   * binds, and until then the rows simply have not appeared yet.
   */
  private resolveRunId(watched: WatchedWorkflow): string | undefined {
    if (watched.runId) return watched.runId;
    const claimed = new Set(
      [...this.watched.values()].map((other) => other.runId).filter((id) => id !== undefined),
    );
    const candidates = this.listRunIds().filter(
      (runId) => !watched.preexistingRunIds.has(runId) && !claimed.has(runId),
    );
    if (candidates.length !== 1) return undefined;
    watched.runId = candidates[0];
    return watched.runId;
  }

  private listRunIds(): string[] {
    const sessionDirectory = this.input.resolveSessionDirectory();
    if (!sessionDirectory) return [];
    return readDirectory(path.join(sessionDirectory, "subagents", "workflows"))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  /**
   * The bytes appended to a transcript since the last tick.
   *
   * A trailing partial line is left for the next read rather than parsed: Claude appends a
   * transcript entry as one line, and a half-written one is not an entry yet. Truncation — a file
   * that shrank — resets the offset, so a rewritten transcript replays rather than reads garbage
   * from the middle of a line.
   */
  private readAppended(watched: WatchedWorkflow, filePath: string): string | undefined {
    let size: number;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      return undefined;
    }
    const previous = watched.transcriptOffsets.get(filePath) ?? 0;
    const offset = size < previous ? 0 : previous;
    if (size === offset) return undefined;

    let handle: number | undefined;
    try {
      handle = fs.openSync(filePath, "r");
      const buffer = Buffer.alloc(size - offset);
      const bytesRead = fs.readSync(handle, buffer, 0, buffer.length, offset);
      const chunk = buffer.subarray(0, bytesRead).toString("utf8");
      const lastNewline = chunk.lastIndexOf("\n");
      if (lastNewline < 0) return undefined;
      watched.transcriptOffsets.set(
        filePath,
        offset + Buffer.byteLength(chunk.slice(0, lastNewline + 1), "utf8"),
      );
      return chunk.slice(0, lastNewline + 1);
    } catch {
      return undefined;
    } finally {
      if (handle !== undefined) fs.closeSync(handle);
    }
  }
}

function readDirectory(directory: string): fs.Dirent[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

function readFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function readJson(filePath: string): unknown {
  const contents = readFile(filePath);
  if (contents === undefined) return undefined;
  try {
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
}
