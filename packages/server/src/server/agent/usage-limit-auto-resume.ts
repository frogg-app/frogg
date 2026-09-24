import type { Logger } from "pino";
import type { AgentStreamEvent, UsageLimitSignal } from "./agent-sdk-types.js";
import type { AgentManager, AgentManagerEvent } from "./agent-manager.js";
import { detectUsageLimitFromText } from "./usage-limit.js";

/** Resume a minute after the window resets so the provider has definitely rolled over. */
export const AUTO_RESUME_GRACE_MS = 60_000;
/** Used when the provider refused the turn without saying when the limit resets. */
export const AUTO_RESUME_UNKNOWN_RESET_MS = 30 * 60_000;
/** Consecutive resumes that immediately hit the limit again before we give up. */
export const AUTO_RESUME_MAX_ATTEMPTS = 6;
/** Longest delay setTimeout honours; longer waits re-arm. */
const MAX_TIMER_MS = 2_147_483_647;
/** Only short replies are read as limit notices, so a turn *discussing* limits is not one. */
const MAX_NOTICE_CHARS = 400;

export const AUTO_RESUME_PROMPT =
  "Your usage limit has reset. Continue where you left off; if the previous task is already complete, say so briefly.";

interface Timers {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface UsageLimitAutoResumeOptions {
  agentManager: Pick<
    AgentManager,
    "subscribe" | "getAgent" | "setAgentAutoResume" | "getLastAssistantMessage"
  >;
  isEnabled: () => boolean;
  resume: (agentId: string, prompt: string) => Promise<void>;
  logger: Logger;
  now?: () => Date;
  timers?: Timers;
}

export interface UsageLimitAutoResume {
  cancelAll(): void;
  dispose(): void;
}

interface Pending {
  handle: unknown;
  resumeAt: Date;
}

/**
 * Watches every agent's turns for a provider usage-limit rejection and queues a resume prompt for
 * shortly after the reset. The queued resume is published on the agent snapshot; clearing it
 * there (the cancel RPC, or the user sending anything) drops the timer.
 */
export function setupUsageLimitAutoResume(
  options: UsageLimitAutoResumeOptions,
): UsageLimitAutoResume {
  const log = options.logger.child({ module: "usage-limit-auto-resume" });
  const now = options.now ?? (() => new Date());
  const timers: Timers = options.timers ?? {
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const pending = new Map<string, Pending>();
  const attempts = new Map<string, number>();

  function clearTimer(agentId: string): void {
    const entry = pending.get(agentId);
    if (!entry) return;
    timers.clearTimeout(entry.handle);
    pending.delete(agentId);
  }

  function cancel(agentId: string): void {
    clearTimer(agentId);
    options.agentManager.setAgentAutoResume(agentId, null);
  }

  function arm(agentId: string, resumeAt: Date): void {
    const delay = Math.max(0, resumeAt.getTime() - now().getTime());
    const handle = timers.setTimeout(
      () => {
        if (delay > MAX_TIMER_MS) {
          arm(agentId, resumeAt);
          return;
        }
        fire(agentId);
      },
      Math.min(delay, MAX_TIMER_MS),
    );
    pending.set(agentId, { handle, resumeAt });
  }

  function schedule(agentId: string, signal: UsageLimitSignal): void {
    const agent = options.agentManager.getAgent(agentId);
    if (!agent || agent.internal || agent.lifecycle === "closed") return;
    const count = (attempts.get(agentId) ?? 0) + 1;
    if (count > AUTO_RESUME_MAX_ATTEMPTS) {
      log.warn({ agentId }, "Usage limit persisted across auto-resumes; giving up");
      attempts.delete(agentId);
      return;
    }
    attempts.set(agentId, count);

    const detectedAt = now();
    const resetsAt = signal.resetsAt ? new Date(signal.resetsAt) : null;
    const base =
      resetsAt && resetsAt.getTime() > detectedAt.getTime()
        ? resetsAt.getTime()
        : detectedAt.getTime() + AUTO_RESUME_UNKNOWN_RESET_MS;
    const resumeAt = new Date(base + AUTO_RESUME_GRACE_MS);

    clearTimer(agentId);
    arm(agentId, resumeAt);
    options.agentManager.setAgentAutoResume(agentId, {
      resumeAt,
      resetsAt,
      detectedAt,
    });
    log.info({ agentId, resumeAt: resumeAt.toISOString() }, "Queued resume after usage limit");
  }

  function fire(agentId: string): void {
    pending.delete(agentId);
    const agent = options.agentManager.getAgent(agentId);
    options.agentManager.setAgentAutoResume(agentId, null);
    if (!agent || agent.lifecycle === "closed" || agent.lifecycle === "running") return;
    if (!options.isEnabled()) return;
    options.resume(agentId, AUTO_RESUME_PROMPT).catch((error: unknown) => {
      log.warn({ err: error, agentId }, "Auto-resume prompt failed");
    });
  }

  async function detect(
    agentId: string,
    event: Extract<AgentStreamEvent, { type: "turn_completed" | "turn_failed" }>,
  ): Promise<UsageLimitSignal | null> {
    if (event.usageLimit) return event.usageLimit;
    if (event.type === "turn_failed") {
      return (
        detectUsageLimitFromText(event.error, now()) ??
        detectUsageLimitFromText(event.diagnostic, now())
      );
    }
    const reply = await options.agentManager.getLastAssistantMessage(agentId);
    if (!reply || reply.length > MAX_NOTICE_CHARS) return null;
    return detectUsageLimitFromText(reply, now());
  }

  async function onTurnEnded(
    agentId: string,
    event: Extract<AgentStreamEvent, { type: "turn_completed" | "turn_failed" }>,
  ): Promise<void> {
    const signal = await detect(agentId, event);
    if (!signal) {
      if (event.type === "turn_completed") attempts.delete(agentId);
      return;
    }
    if (!options.isEnabled()) return;
    schedule(agentId, signal);
  }

  function onEvent(event: AgentManagerEvent): void {
    if (event.type === "agent_state") {
      const { agent } = event;
      if (pending.has(agent.id) && (!agent.autoResume || agent.lifecycle === "closed")) {
        clearTimer(agent.id);
      }
      return;
    }
    if (event.type !== "agent_stream") return;
    const stream = event.event;
    if (stream.type === "turn_started") {
      // Anything that starts a turn, the user or the resume itself, supersedes the queued one.
      if (pending.has(event.agentId)) cancel(event.agentId);
      return;
    }
    if (stream.type === "turn_completed" || stream.type === "turn_failed") {
      onTurnEnded(event.agentId, stream).catch((error: unknown) => {
        log.warn({ err: error, agentId: event.agentId }, "Usage-limit detection failed");
      });
    }
  }

  const unsubscribe = options.agentManager.subscribe(onEvent);

  return {
    cancelAll() {
      for (const agentId of pending.keys()) cancel(agentId);
    },
    dispose() {
      unsubscribe();
      for (const agentId of pending.keys()) clearTimer(agentId);
    },
  };
}
