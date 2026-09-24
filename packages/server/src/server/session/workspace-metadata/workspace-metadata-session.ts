// Workspace title and pin RPCs. Extracted from session.ts.
import { v4 as uuidv4 } from "uuid";
import { getErrorMessage, getErrorMessageOr } from "@frogg/protocol/error-utils";
import type { SessionOutboundMessage } from "../../messages.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";

export interface WorkspaceMetadataSessionDependencies {
  workspaceRegistry: Pick<WorkspaceRegistry, "update">;
  emit(message: SessionOutboundMessage): void;
  emitWorkspaceUpdates(workspaceIds: string[]): Promise<void>;
  logger: {
    info(context: object, message: string): void;
    error(context: object, message: string): void;
  };
}

export class WorkspaceMetadataSession {
  constructor(private readonly deps: WorkspaceMetadataSessionDependencies) {}

  async setTitle(workspaceId: string, title: string | null, requestId: string): Promise<void> {
    this.deps.logger.info(
      { workspaceId, requestId, hasTitle: typeof title === "string" },
      "session: workspace.title.set.request",
    );

    try {
      const trimmed = title?.trim() ?? "";
      const nextTitle = trimmed.length === 0 ? null : trimmed;
      const updatedAt = new Date().toISOString();
      const updated = await this.deps.workspaceRegistry.update(workspaceId, (existing) => ({
        ...existing,
        title: nextTitle,
        updatedAt,
      }));
      if (!updated) {
        this.deps.emit({
          type: "workspace.title.set.response",
          payload: {
            requestId,
            workspaceId,
            accepted: false,
            title: null,
            error: "Workspace not found",
          },
        });
        return;
      }

      this.deps.emit({
        type: "workspace.title.set.response",
        payload: {
          requestId,
          workspaceId,
          accepted: true,
          title: nextTitle,
          error: null,
        },
      });

      await this.deps.emitWorkspaceUpdates([workspaceId]);
    } catch (error) {
      this.deps.logger.error(
        { err: error, workspaceId, requestId },
        "session: workspace.title.set.request error",
      );
      this.deps.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to set workspace title: ${getErrorMessage(error)}`,
        },
      });
      this.deps.emit({
        type: "workspace.title.set.response",
        payload: {
          requestId,
          workspaceId,
          accepted: false,
          title: null,
          error: getErrorMessageOr(error, "Failed to set workspace title"),
        },
      });
    }
  }

  async setPinned(workspaceId: string, pinned: boolean, requestId: string): Promise<void> {
    const logContext = { workspaceId, pinned, requestId };
    this.deps.logger.info(logContext, "session: workspace.pin.set.request");
    const emitResponse = (accepted: boolean, pinnedAt: string | null, error: string | null) => {
      this.deps.emit({
        type: "workspace.pin.set.response",
        payload: { requestId, workspaceId, accepted, pinnedAt, error },
      });
    };

    try {
      const nextPinnedAt = pinned ? new Date().toISOString() : null;
      const updatedAt = new Date().toISOString();
      const updated = await this.deps.workspaceRegistry.update(workspaceId, (existing) => ({
        ...existing,
        pinnedAt: nextPinnedAt,
        updatedAt,
      }));
      if (!updated) {
        emitResponse(false, null, "Workspace not found");
        return;
      }
      emitResponse(true, nextPinnedAt, null);
      await this.deps.emitWorkspaceUpdates([workspaceId]);
    } catch (error) {
      this.deps.logger.error(
        { ...logContext, err: error },
        "session: workspace.pin.set.request error",
      );
      this.deps.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "error",
          content: `Failed to pin workspace: ${getErrorMessage(error)}`,
        },
      });
      emitResponse(false, null, getErrorMessageOr(error, "Failed to pin workspace"));
    }
  }
}
