import { brand } from "@frogg/branding";
import type { Logger } from "pino";
import type { AgentManager, ManagedAgent } from "./agent-manager.js";
import type { AgentStorage, StoredAgentRecord } from "./agent-storage.js";
import { ensureAgentLoaded } from "./agent-loading.js";
import { sendPromptToAgent } from "./agent-prompt.js";

export const DAEMON_RESTART_INTERRUPT_REASON = "daemon_restart";
/**
 * How old an interrupted turn may be and still resume. The limit keeps a daemon
 * that was down for days from waking long-abandoned tasks; within a day the
 * work is still likely wanted. It is deliberately longer than any provider's
 * prompt cache lifetime, so a turn resumed after that lifetime gets an
 * automatic clean cut first (see auto-clean-cut.ts) instead of re-sending the
 * whole context at full price.
 */
export const INTERRUPTED_TURN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const INTERRUPTED_TURN_CONTINUATION_PROMPT =
  `The ${brand.name} daemon restarted while you were mid-turn, so your last tool call was killed. ` +
  "Re-check the current state and continue the task where you left off.";

type LiveAgentShape = Pick<
  ManagedAgent,
  "id" | "internal" | "persistence" | "lifecycle" | "activeForegroundTurnId"
>;

/** Agents that should be auto-continued if the daemon stops right now. */
export function collectMidTurnAgentIds(agents: readonly LiveAgentShape[]): string[] {
  return agents
    .filter(
      (agent) =>
        !agent.internal &&
        Boolean(agent.persistence?.sessionId) &&
        (agent.lifecycle === "running" || Boolean(agent.activeForegroundTurnId)),
    )
    .map((agent) => agent.id);
}

export function isResumableInterruptedRecord(record: StoredAgentRecord, now: number): boolean {
  if (!record.interruptedTurn || record.archivedAt || record.internal) {
    return false;
  }
  const at = Date.parse(record.interruptedTurn.at);
  return Number.isFinite(at) && now - at <= INTERRUPTED_TURN_MAX_AGE_MS && now - at >= -60_000;
}

export interface ResumeInterruptedAgentsDeps {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  logger: Logger;
  now?: () => number;
  sendPrompt?: typeof sendPromptToAgent;
  /**
   * Runs once the agent is loaded and before the continuation prompt, with the
   * time the turn was cut off (the automatic clean cut hooks in here). Must not
   * throw; a rejection is logged and the resume goes ahead.
   */
  beforeResume?: (agentId: string, interruptedAt: Date) => Promise<void>;
}

/**
 * Continue agents whose turn was cut off by a daemon restart. Sequential, never
 * throws. The flag is cleared before prompting so a crash loop cannot re-prompt
 * the same agent forever.
 */
export async function resumeInterruptedAgents(
  deps: ResumeInterruptedAgentsDeps,
): Promise<string[]> {
  const logger = deps.logger.child({ component: "interrupted-turn-resume" });
  const sendPrompt = deps.sendPrompt ?? sendPromptToAgent;
  const resumed: string[] = [];
  let records: StoredAgentRecord[];
  try {
    records = await deps.agentStorage.list();
  } catch (error) {
    logger.error({ err: error }, "Failed to list agents for interrupted-turn resume");
    return resumed;
  }
  const now = (deps.now ?? Date.now)();
  for (const record of records) {
    if (!record.interruptedTurn) {
      continue;
    }
    const resumable = isResumableInterruptedRecord(record, now);
    try {
      await deps.agentStorage.clearInterruptedTurn(record.id);
    } catch (error) {
      logger.warn({ err: error, agentId: record.id }, "Failed to clear interrupted-turn flag");
      continue;
    }
    if (!resumable) {
      continue;
    }
    if (deps.beforeResume) {
      try {
        await ensureAgentLoaded(record.id, {
          agentManager: deps.agentManager,
          agentStorage: deps.agentStorage,
          logger,
        });
        await deps.beforeResume(record.id, new Date(Date.parse(record.interruptedTurn.at)));
      } catch (error) {
        logger.warn({ err: error, agentId: record.id }, "Pre-resume step failed; resuming anyway");
      }
    }
    try {
      await sendPrompt({
        agentManager: deps.agentManager,
        agentStorage: deps.agentStorage,
        agentId: record.id,
        prompt: INTERRUPTED_TURN_CONTINUATION_PROMPT,
        unarchive: false,
        logger,
      });
      resumed.push(record.id);
      logger.info({ agentId: record.id }, "Resumed agent interrupted by daemon restart");
    } catch (error) {
      logger.error({ err: error, agentId: record.id }, "Failed to resume interrupted agent");
    }
  }
  return resumed;
}
