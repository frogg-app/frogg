// Agent delete, archive, detach and auto-resume cancellation RPCs.
// Extracted from session.ts.
import { getErrorMessageOr } from "@frogg/protocol/error-utils";
import type { Logger } from "pino";
import type { AgentManager } from "../../agent/agent-manager.js";
import type { AgentStorage } from "../../agent/agent-storage.js";
import {
  archiveAgentCommand,
  closeAgentCommand,
  detachAgentCommand,
} from "../../agent/lifecycle-command.js";
import type { SessionOutboundMessage } from "../../messages.js";
import type { AgentUpdatesService } from "../agent-updates/agent-updates-service.js";

type DeleteFencedAgentStorage = AgentStorage & {
  beginDelete(agentId: string): void;
};

function beginAgentDeleteIfSupported(agentStorage: AgentStorage, agentId: string): void {
  if ("beginDelete" in agentStorage && typeof agentStorage.beginDelete === "function") {
    (agentStorage as DeleteFencedAgentStorage).beginDelete(agentId);
  }
}

export interface AgentLifecycleSessionDependencies {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  agentUpdates: AgentUpdatesService;
  logger: Logger;
  emit(message: SessionOutboundMessage): void;
  emitWorkspaceUpdate(workspaceId: string): Promise<void>;
  emitWorkspaceUpdates(workspaceIds: Iterable<string>): Promise<void>;
  resolveDelegationRootWorkspaceId(agentId: string): Promise<string | null>;
}

export class AgentLifecycleSession {
  constructor(private readonly deps: AgentLifecycleSessionDependencies) {}

  async delete(agentId: string, requestId: string): Promise<void> {
    this.deps.logger.info({ agentId }, `Deleting agent ${agentId} from registry`);

    const knownWorkspaceId =
      this.deps.agentManager.getAgent(agentId)?.workspaceId ??
      (await this.deps.agentStorage.get(agentId))?.workspaceId ??
      null;

    // File-backed storage still needs an early delete fence before closeAgent().
    beginAgentDeleteIfSupported(this.deps.agentStorage, agentId);

    try {
      await closeAgentCommand({ agentManager: this.deps.agentManager }, agentId);
    } catch (error) {
      this.deps.logger.warn(
        { err: error, agentId },
        `Failed to close agent ${agentId} during delete`,
      );
    }

    // Drain queued persistence from the just-closed agent before removing its
    // durable snapshot, otherwise an in-flight background write can recreate it.
    await this.deps.agentManager.flush();

    try {
      await this.deps.agentStorage.remove(agentId);
      await this.deps.agentManager.deleteAgentState(agentId);
    } catch (error) {
      this.deps.logger.error({ err: error, agentId }, `Failed to fully delete agent ${agentId}`);
    }

    this.deps.emit({
      type: "agent_deleted",
      payload: {
        agentId,
        requestId,
      },
    });

    await this.deps.agentUpdates.removeAgent(agentId);

    if (knownWorkspaceId) {
      await this.deps.emitWorkspaceUpdate(knownWorkspaceId);
    }
  }

  async archive(agentId: string, requestId: string): Promise<void> {
    this.deps.logger.info({ agentId }, `Archiving agent ${agentId}`);

    const { archivedAt } = await this.archiveForClose(agentId);

    this.deps.emit({
      type: "agent_archived",
      payload: {
        agentId,
        archivedAt,
        requestId,
      },
    });
  }

  async archiveForClose(agentId: string): Promise<{ agentId: string; archivedAt: string }> {
    const { archivedAt, record: archivedRecord } = await archiveAgentCommand(
      {
        agentManager: this.deps.agentManager,
        agentStorage: this.deps.agentStorage,
        logger: this.deps.logger,
      },
      agentId,
    );

    if (this.deps.agentUpdates.hasSubscription()) {
      const payload = await this.deps.agentUpdates.emitStoredRecord(archivedRecord);
      if (payload.workspaceId) {
        await this.deps.emitWorkspaceUpdate(payload.workspaceId);
      }
    }

    return { agentId, archivedAt };
  }

  async cancelAutoResume(agentId: string, requestId: string): Promise<void> {
    const found = this.deps.agentManager.getAgent(agentId) !== null;
    if (found) this.deps.agentManager.setAgentAutoResume(agentId, null);
    this.deps.emit({
      type: "agent.cancel_auto_resume.response",
      payload: {
        requestId,
        agentId,
        accepted: found,
        error: found ? null : "Agent not found",
      },
    });
  }

  async detach(agentId: string, requestId: string): Promise<void> {
    this.deps.logger.info({ agentId, requestId }, "Detaching agent from parent");

    try {
      const result = await detachAgentCommand({ agentManager: this.deps.agentManager }, agentId);
      const affectedWorkspaceIds = new Set<string>();

      if (!result.live) {
        const payload = await this.deps.agentUpdates.emitStoredRecord(result.record);
        if (payload.workspaceId) {
          affectedWorkspaceIds.add(payload.workspaceId);
        }
      } else if (result.record.workspaceId) {
        affectedWorkspaceIds.add(result.record.workspaceId);
      }

      if (result.previousParentAgentId) {
        const rootWorkspaceId = await this.deps.resolveDelegationRootWorkspaceId(
          result.previousParentAgentId,
        );
        if (rootWorkspaceId) {
          affectedWorkspaceIds.add(rootWorkspaceId);
        }
      }

      await this.deps.emitWorkspaceUpdates(affectedWorkspaceIds);

      this.deps.emit({
        type: "agent.detach.response",
        payload: {
          requestId,
          agentId,
          accepted: true,
          error: null,
        },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to detach agent");
      this.deps.logger.error({ err: error, agentId, requestId }, "Failed to detach agent");
      this.deps.emit({
        type: "agent.detach.response",
        payload: {
          requestId,
          agentId,
          accepted: false,
          error: message,
        },
      });
    }
  }
}
