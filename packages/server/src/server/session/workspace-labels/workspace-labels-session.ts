// Workspace label RPCs for one client session: the live label subscription
// and the list/assign/update/delete requests. Extracted from session.ts.
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import {
  WorkspaceLabelError,
  WorkspaceLabelStorageUncertainError,
  type WorkspaceLabelService,
} from "../../workspace-labels/index.js";

class WorkspaceLabelsUnavailableError extends Error {
  readonly code = "workspace_labels_unavailable";
  constructor() {
    super("Workspace labels unavailable");
  }
}

function workspaceLabelErrorCode(error: unknown): string {
  if (
    error instanceof WorkspaceLabelError ||
    error instanceof WorkspaceLabelStorageUncertainError ||
    error instanceof WorkspaceLabelsUnavailableError
  ) {
    return error.code;
  }
  return "workspace_label_failed";
}

export interface WorkspaceLabelsSessionDependencies {
  service: WorkspaceLabelService | null;
  emit(message: SessionOutboundMessage): void;
}

export class WorkspaceLabelsSession {
  private subscription: { owner: object; id: string; unsubscribe: () => void } | null = null;

  constructor(private readonly deps: WorkspaceLabelsSessionDependencies) {}

  /** Handles a workspace label message, or returns undefined for anything else. */
  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "workspace.label.list.request":
        return this.handleWorkspaceLabelList(msg);
      case "workspace.label.assignment.set.request":
        return this.handleWorkspaceLabelAssignment(msg);
      case "workspace.label.update.request":
        return this.handleWorkspaceLabelUpdate(msg);
      case "workspace.label.delete.request":
        return this.handleWorkspaceLabelDelete(msg);
      case "workspace.label.delete.inspect.request":
        return this.handleWorkspaceLabelDeleteInspection(msg);
      default:
        return undefined;
    }
  }

  close(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  private requireService(): WorkspaceLabelService {
    if (!this.deps.service) throw new WorkspaceLabelsUnavailableError();
    return this.deps.service;
  }

  private emitError(request: { requestId: string; type: string }, error: unknown): void {
    this.deps.emit({
      type: "rpc_error",
      payload: {
        requestId: request.requestId,
        requestType: request.type,
        code: workspaceLabelErrorCode(error),
        error: error instanceof Error ? error.message : "Workspace label operation failed",
      },
    });
  }

  private async handleWorkspaceLabelList(
    request: Extract<SessionInboundMessage, { type: "workspace.label.list.request" }>,
  ): Promise<void> {
    const owner = {};
    try {
      this.subscription?.unsubscribe();
      this.subscription = {
        owner,
        id: request.subscribe.subscriptionId,
        unsubscribe: () => undefined,
      };
      const service = this.requireService();
      type LiveChange = Parameters<Parameters<typeof service.subscribe>[0]["onChange"]>[0];
      const pending: LiveChange[] = [];
      let ready = false;
      const emitChange = (change: LiveChange): void => {
        this.deps.emit({
          type: "workspace.label.update",
          payload:
            change.kind === "upsert"
              ? {
                  kind: "upsert",
                  label: change.label,
                  ...(change.previousName ? { previousName: change.previousName } : {}),
                  generation: change.generation,
                  seq: change.seq,
                }
              : {
                  kind: "remove",
                  name: change.name,
                  generation: change.generation,
                  seq: change.seq,
                },
        });
      };
      const subscription = await service.subscribe({
        cursor: request.sync,
        onChange: (change) => {
          if (this.subscription?.owner !== owner) return;
          if (!ready) pending.push(change);
          else emitChange(change);
        },
      });
      const ownsSubscription = this.subscription?.owner === owner;
      if (ownsSubscription) {
        this.subscription = {
          owner,
          id: request.subscribe.subscriptionId,
          unsubscribe: subscription.unsubscribe,
        };
      } else {
        subscription.unsubscribe();
      }
      this.deps.emit({
        type: "workspace.label.list.response",
        payload: { requestId: request.requestId, ...subscription.snapshot },
      });
      ready = true;
      if (ownsSubscription) {
        for (const change of pending) {
          if (change.seq > subscription.snapshot.sync.headSeq) emitChange(change);
        }
      }
    } catch (error) {
      if (this.subscription?.owner === owner) {
        this.subscription = null;
      }
      this.emitError(request, error);
    }
  }

  private async handleWorkspaceLabelAssignment(
    request: Extract<SessionInboundMessage, { type: "workspace.label.assignment.set.request" }>,
  ): Promise<void> {
    try {
      const result = await this.requireService().setAssignment(request);
      this.deps.emit({
        type: "workspace.label.assignment.set.response",
        payload: { requestId: request.requestId, ...result },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  private async handleWorkspaceLabelUpdate(
    request: Extract<SessionInboundMessage, { type: "workspace.label.update.request" }>,
  ): Promise<void> {
    try {
      const result = await this.requireService().update(request);
      this.deps.emit({
        type: "workspace.label.update.response",
        payload: { requestId: request.requestId, ...result },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  private async handleWorkspaceLabelDelete(
    request: Extract<SessionInboundMessage, { type: "workspace.label.delete.request" }>,
  ): Promise<void> {
    try {
      const result = await this.requireService().delete(request.name);
      this.deps.emit({
        type: "workspace.label.delete.response",
        payload: { requestId: request.requestId, ...result },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }

  private async handleWorkspaceLabelDeleteInspection(
    request: Extract<SessionInboundMessage, { type: "workspace.label.delete.inspect.request" }>,
  ): Promise<void> {
    try {
      const affectedWorkspaceCount = await this.requireService().countAffectedWorkspaces(
        request.name,
      );
      this.deps.emit({
        type: "workspace.label.delete.inspect.response",
        payload: { requestId: request.requestId, affectedWorkspaceCount },
      });
    } catch (error) {
      this.emitError(request, error);
    }
  }
}
