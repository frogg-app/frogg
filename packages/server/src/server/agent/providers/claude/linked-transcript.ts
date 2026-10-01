import fs from "node:fs";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";

/**
 * Linked conversations: two processes (two Frogg daemons, or a daemon and a terminal
 * `claude --resume`) can hold the same Claude session. Each Claude process keeps its own place in
 * the conversation, so without coordination they fork the transcript and stop seeing each other.
 *
 * - `TranscriptFollower` reads what others append to the session's transcript while this session
 *   is idle, so it can show those turns and resume from them.
 * - `TurnLease` lets one process run a turn at a time: a small file beside the transcript, held
 *   for the length of a turn and refreshed while it runs.
 */

const POLL_MS = 1000;
const LEASE_HEARTBEAT_MS = 15_000;
/** A lease not refreshed for this long belongs to a process that died mid-turn. */
const LEASE_STALE_MS = 60_000;
const LEASE_WAIT_POLL_MS = 500;

export interface TranscriptFollowerOptions {
  /** The transcript to follow; null until the session has one. Re-read on every poll. */
  resolvePath: () => string | null;
  /** This session is running a turn of its own: whatever is appended now is its own. */
  isBusy: () => boolean;
  /** Complete lines someone else appended while this session was idle. */
  onForeignLines: (lines: string[]) => void;
  logger: Logger;
  pollMs?: number;
}

export class TranscriptFollower {
  private readonly options: TranscriptFollowerOptions;
  private path: string | null = null;
  private offset = 0;
  private timer: NodeJS.Timeout | null = null;
  private reading = false;

  constructor(options: TranscriptFollowerOptions) {
    this.options = options;
  }

  start(): void {
    if (this.timer) return;
    this.skipToEnd();
    this.timer = setInterval(() => this.poll(), this.options.pollMs ?? POLL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Everything written so far is known: this session's own turn, or history it already loaded. */
  skipToEnd(): void {
    this.path = this.options.resolvePath();
    this.offset = this.path ? sizeOf(this.path) : 0;
  }

  /**
   * One poll. `force` reads even while this session is busy: used right after taking the turn
   * lease, before this session writes anything, to pick up what the other side just finished.
   */
  poll(force = false): void {
    if (this.reading) return;
    const path = this.options.resolvePath();
    if (path !== this.path) {
      // A new or rebound session: start following it from its current end.
      this.path = path;
      this.offset = path ? sizeOf(path) : 0;
      return;
    }
    if (!path) return;
    const size = sizeOf(path);
    if (size < this.offset) {
      this.offset = size;
      return;
    }
    if (size === this.offset) return;
    if (!force && this.options.isBusy()) return;
    this.reading = true;
    try {
      const chunk = readRange(path, this.offset, size);
      const lastNewline = chunk.lastIndexOf("\n");
      // Leave a partly written last line for the next poll.
      if (lastNewline === -1) return;
      this.offset += Buffer.byteLength(chunk.slice(0, lastNewline + 1));
      const lines = chunk
        .slice(0, lastNewline)
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);
      if (lines.length > 0) this.options.onForeignLines(lines);
    } catch (error) {
      this.options.logger.warn({ err: error, path }, "Failed to follow a linked transcript");
    } finally {
      this.reading = false;
    }
  }
}

function sizeOf(path: string): number {
  try {
    return fs.statSync(path).size;
  } catch {
    return 0;
  }
}

function readRange(path: string, start: number, end: number): string {
  const fd = fs.openSync(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

interface LeaseRecord {
  owner: string;
  host: string;
  pid: number;
  label: string;
  at: number;
}

export interface TurnLeaseOptions {
  /** `<transcript>.frogg-turn`; null while the session has no transcript yet. */
  resolvePath: () => string | null;
  /** Who holds it, shown to the other side: a daemon's name. */
  label: string;
  logger: Logger;
  now?: () => number;
  isProcessAlive?: (pid: number) => boolean;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class TurnLease {
  private readonly options: TurnLeaseOptions;
  private readonly owner = `${os.hostname()}:${process.pid}:${randomUUID()}`;
  private heldPath: string | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(options: TurnLeaseOptions) {
    this.options = options;
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  /** Who else is running a turn in this conversation right now, if anyone. */
  heldElsewhere(): { label: string } | null {
    const path = this.options.resolvePath();
    if (!path) return null;
    const record = readLease(path);
    if (!record || record.owner === this.owner || this.isStale(record)) return null;
    return { label: record.label };
  }

  private isStale(record: LeaseRecord): boolean {
    if (this.now() - record.at > LEASE_STALE_MS) return true;
    const alive = this.options.isProcessAlive ?? processAlive;
    return record.host === os.hostname() && !alive(record.pid);
  }

  /** Takes the lease if nobody else holds it. */
  tryAcquire(): boolean {
    const path = this.options.resolvePath();
    if (!path) return true;
    if (this.heldElsewhere()) return false;
    this.write(path);
    // Two processes can pass the check together; the last write wins, and the loser sees it.
    const record = readLease(path);
    if (record && record.owner !== this.owner) return false;
    this.heldPath = path;
    this.heartbeat ??= setInterval(() => {
      if (this.heldPath) this.write(this.heldPath);
    }, LEASE_HEARTBEAT_MS);
    this.heartbeat.unref?.();
    return true;
  }

  /**
   * Waits for the other process's turn to end, then takes the lease. `onWaiting` fires once, when
   * it first has to wait. Resolves false when `isCancelled` turns true.
   */
  async acquire(input: {
    isCancelled: () => boolean;
    onWaiting?: (holder: { label: string }) => void;
  }): Promise<boolean> {
    let announced = false;
    while (!input.isCancelled()) {
      if (this.tryAcquire()) return true;
      const holder = this.heldElsewhere();
      if (holder && !announced) {
        announced = true;
        input.onWaiting?.(holder);
      }
      await new Promise((resolve) => setTimeout(resolve, LEASE_WAIT_POLL_MS));
    }
    return false;
  }

  release(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    const path = this.heldPath;
    this.heldPath = null;
    if (!path) return;
    const record = readLease(path);
    if (record?.owner !== this.owner) return;
    try {
      fs.rmSync(path, { force: true });
    } catch (error) {
      this.options.logger.warn({ err: error, path }, "Failed to release a conversation turn lease");
    }
  }

  private write(path: string): void {
    const record: LeaseRecord = {
      owner: this.owner,
      host: os.hostname(),
      pid: process.pid,
      label: this.options.label,
      at: this.now(),
    };
    try {
      fs.writeFileSync(path, JSON.stringify(record));
    } catch (error) {
      this.options.logger.warn({ err: error, path }, "Failed to write a conversation turn lease");
    }
  }
}

function readLease(path: string): LeaseRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(path, "utf8")) as Partial<LeaseRecord>;
    if (typeof parsed.owner !== "string" || typeof parsed.at !== "number") return null;
    return {
      owner: parsed.owner,
      host: typeof parsed.host === "string" ? parsed.host : "",
      pid: typeof parsed.pid === "number" ? parsed.pid : 0,
      label: typeof parsed.label === "string" ? parsed.label : "another process",
      at: parsed.at,
    };
  } catch {
    return null;
  }
}
