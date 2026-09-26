/**
 * COMPAT(sessionPresence): added in v1.6.0.
 *
 * Reporting side of session presence, with no React in it.
 *
 * The daemon expires an entry after `PRESENCE_ENTRY_TTL_MS`, and only pushes
 * `presence.update` for targets this session has reported on — so reporting is
 * also what subscribes. Two surfaces watch the same target at once (an agent
 * panel's presence row and its composer), so reporters are refcounted per
 * target: one heartbeat on the wire however many components are looking, one
 * `left` when the last of them goes away.
 */
import type { PresenceReportState, PresenceTarget } from "@frogg/protocol/device-access";
import { PRESENCE_REPORT_INTERVAL_MS } from "@/presence/snapshot";
import { presenceTargetKey } from "@/presence/target";
import { resolveSelfDisplayName } from "@/presence/identity-store";

/** What a single surface claims. `null` means "not looking right now". */
export type PresenceMemberState = "viewing" | "typing" | "idle" | null;

export interface PresenceReportTransport {
  reportPresence(input: {
    target: PresenceTarget;
    state: PresenceReportState;
    deviceName?: string;
  }): Promise<{ error: string | null }>;
}

/**
 * Consecutive failures before the heartbeat stops. A daemon that keeps
 * refusing presence gets left alone until something changes — a state change or
 * a reconnect — rather than being poked every 30 seconds forever.
 */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Typing outranks viewing outranks idle; the row should show the loudest claim. */
export function resolveReportedState(members: Iterable<PresenceMemberState>): PresenceMemberState {
  let resolved: PresenceMemberState = null;
  for (const member of members) {
    if (member === "typing") return "typing";
    if (member === "viewing") resolved = "viewing";
    else if (member === "idle" && resolved === null) resolved = "idle";
  }
  return resolved;
}

export interface PresenceReporterOptions {
  transport: PresenceReportTransport;
  target: PresenceTarget;
  intervalMs?: number;
  onFailure?: (error: string) => void;
}

/**
 * Keeps one target's entry alive on one daemon. Reports immediately when the
 * state changes and then on a fixed cadence, and reports `left` on stop.
 */
export class PresenceReporter {
  private transport: PresenceReportTransport;
  private readonly target: PresenceTarget;
  private readonly intervalMs: number;
  private readonly onFailure: ((error: string) => void) | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: PresenceMemberState = null;
  private consecutiveFailures = 0;
  private stopped = false;

  constructor(options: PresenceReporterOptions) {
    this.transport = options.transport;
    this.target = options.target;
    this.intervalMs = options.intervalMs ?? PRESENCE_REPORT_INTERVAL_MS;
    this.onFailure = options.onFailure;
  }

  /**
   * A reconnect can hand the app a freshly built client for the same daemon.
   * The reporter outlives it, so it is pointed at the new one rather than
   * rebuilt — rebuilding would lose the refcount the surfaces are holding.
   */
  setTransport(transport: PresenceReportTransport): void {
    this.transport = transport;
  }

  /** True once presence has been refused often enough to stop the heartbeat. */
  get isSuspended(): boolean {
    return this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
  }

  setState(state: PresenceMemberState): void {
    if (this.stopped || state === this.current) return;
    this.current = state;
    // A state change is also the signal that whatever was wrong may not be any
    // more, so a suspended reporter gets one more chance here.
    this.consecutiveFailures = 0;
    if (state === null) {
      this.clearTimer();
      void this.send("left");
      return;
    }
    void this.send(state);
    this.startTimer();
  }

  /**
   * The daemon forgets every reported target when the session drops, so a
   * reconnect re-reports at once instead of waiting out the heartbeat.
   */
  handleReconnect(): void {
    if (this.stopped || this.current === null) return;
    this.consecutiveFailures = 0;
    void this.send(this.current);
    this.startTimer();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimer();
    if (this.current !== null) {
      this.current = null;
      void this.send("left");
    }
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      if (this.current === null || this.isSuspended) {
        this.clearTimer();
        return;
      }
      void this.send(this.current);
    }, this.intervalMs);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async send(state: PresenceReportState): Promise<void> {
    try {
      const payload = await this.transport.reportPresence({
        target: this.target,
        state,
        // Riding along on every report is what makes a rename take effect
        // without a reconnect; daemons that predate it ignore the field.
        deviceName: resolveSelfDisplayName(),
      });
      if (payload.error) {
        this.noteFailure(payload.error);
        return;
      }
      this.consecutiveFailures = 0;
    } catch (error) {
      this.noteFailure(error instanceof Error ? error.message : String(error));
    }
  }

  private noteFailure(error: string): void {
    this.consecutiveFailures += 1;
    if (this.isSuspended) this.clearTimer();
    this.onFailure?.(error);
  }
}

export interface PresenceReporterHandle {
  setState: (state: PresenceMemberState) => void;
  release: () => void;
}

interface RegistryEntry {
  reporter: PresenceReporter;
  members: Map<symbol, PresenceMemberState>;
}

/**
 * Refcounts reporters by daemon and target. Callers hold a handle; the last
 * one released takes the entry down, which is what sends `left`.
 */
export class PresenceReporterRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  acquire(input: {
    serverId: string;
    target: PresenceTarget;
    transport: PresenceReportTransport;
    intervalMs?: number;
    onFailure?: (error: string) => void;
  }): PresenceReporterHandle {
    const key = `${input.serverId}|${presenceTargetKey(input.target)}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        reporter: new PresenceReporter({
          transport: input.transport,
          target: input.target,
          ...(input.intervalMs === undefined ? {} : { intervalMs: input.intervalMs }),
          ...(input.onFailure === undefined ? {} : { onFailure: input.onFailure }),
        }),
        members: new Map(),
      };
      this.entries.set(key, entry);
    } else {
      entry.reporter.setTransport(input.transport);
    }
    const memberId = Symbol("presence-member");
    const held = entry;
    held.members.set(memberId, null);
    let released = false;
    return {
      setState: (state) => {
        if (released) return;
        held.members.set(memberId, state);
        held.reporter.setState(resolveReportedState(held.members.values()));
      },
      release: () => {
        if (released) return;
        released = true;
        held.members.delete(memberId);
        if (held.members.size === 0) {
          held.reporter.stop();
          this.entries.delete(key);
          return;
        }
        held.reporter.setState(resolveReportedState(held.members.values()));
      },
    };
  }

  /** Re-reports every live target after a session came back. */
  handleReconnect(serverId: string): void {
    const prefix = `${serverId}|`;
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix)) entry.reporter.handleReconnect();
    }
  }
}

export const presenceReporterRegistry = new PresenceReporterRegistry();
