// Project to-do RPCs for one client session, plus the per-project change
// subscription that pushes `project.todo.changed` to this client.
import type {
  ProjectTodoDetail,
  ProjectTodoError as ProjectTodoWireError,
} from "@frogg/protocol/todos/schemas";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import { ProjectTodoError } from "../../project-todos/operations.js";
import type { ProjectTodoService } from "../../project-todos/service.js";

type Inbound<T extends SessionInboundMessage["type"]> = Extract<SessionInboundMessage, { type: T }>;

type ItemResponseType =
  | "project.todo.get.response"
  | "project.todo.create.response"
  | "project.todo.update.response"
  | "project.todo.update_plan.response"
  | "project.todo.set_status.response"
  | "project.todo.release.response";

export interface ProjectTodosSessionDependencies {
  service: ProjectTodoService | null | undefined;
  emit(message: SessionOutboundMessage): void;
}

export function toProjectTodoWireError(error: unknown): ProjectTodoWireError {
  if (error instanceof ProjectTodoError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.claimants ? { claimants: error.claimants } : {}),
    };
  }
  return {
    code: "todo_failed",
    message: error instanceof Error ? error.message : "Project to-do operation failed",
  };
}

export class ProjectTodosSession {
  private readonly subscribedProjects = new Set<string>();
  private unsubscribeService: (() => void) | null = null;

  constructor(private readonly deps: ProjectTodosSessionDependencies) {}

  /** Handles a project to-do message, or returns undefined for anything else. */
  dispatch(msg: SessionInboundMessage): Promise<void> | undefined {
    switch (msg.type) {
      case "project.todo.list.request":
        return this.handleList(msg);
      case "project.todo.get.request":
        return this.handleItem(msg, "project.todo.get.response", (service) =>
          service.get(msg.projectId, msg.todoId),
        );
      case "project.todo.create.request":
        return this.handleItem(msg, "project.todo.create.response", (service) =>
          service.create(msg.projectId, {
            title: msg.title,
            description: msg.description,
            category: msg.category,
            priority: msg.priority,
            status: msg.status,
            allowParallel: msg.allowParallel,
            plan: msg.plan,
          }),
        );
      case "project.todo.update.request":
        return this.handleItem(msg, "project.todo.update.response", (service) =>
          service.update(msg.projectId, msg.todoId, {
            title: msg.title,
            description: msg.description,
            category: msg.category,
            priority: msg.priority,
            allowParallel: msg.allowParallel,
          }),
        );
      case "project.todo.update_plan.request":
        return this.handleItem(msg, "project.todo.update_plan.response", (service) =>
          service.updatePlan(msg.projectId, msg.todoId, msg.plan),
        );
      case "project.todo.set_status.request":
        return this.handleItem(msg, "project.todo.set_status.response", (service) =>
          service.setStatus(msg.projectId, msg.todoId, msg.status),
        );
      case "project.todo.release.request":
        return this.handleItem(msg, "project.todo.release.response", (service) =>
          service.release(msg.projectId, msg.todoId, msg.agentId),
        );
      case "project.todo.delete.request":
        return this.handleDelete(msg);
      case "project.todo.unsubscribe.request":
        return this.handleUnsubscribe(msg);
      default:
        return undefined;
    }
  }

  close(): void {
    this.subscribedProjects.clear();
    this.unsubscribeService?.();
    this.unsubscribeService = null;
  }

  private requireService(): ProjectTodoService {
    if (!this.deps.service) {
      throw new ProjectTodoError("project_todos_unavailable", "Project to-dos unavailable");
    }
    return this.deps.service;
  }

  private ensureServiceSubscription(service: ProjectTodoService): void {
    if (this.unsubscribeService) return;
    this.unsubscribeService = service.subscribe((change) => {
      if (!this.subscribedProjects.has(change.projectId)) return;
      this.deps.emit({ type: "project.todo.changed", payload: change });
    });
  }

  private async handleList(msg: Inbound<"project.todo.list.request">): Promise<void> {
    try {
      const service = this.requireService();
      if (msg.subscribe) {
        // Subscribe before reading so no change between the read and the
        // response is lost; a duplicate upsert is harmless to clients.
        this.ensureServiceSubscription(service);
        this.subscribedProjects.add(msg.projectId);
      }
      const result = await service.list(msg.projectId, {
        statuses: msg.statuses,
        category: msg.category,
      });
      this.deps.emit({
        type: "project.todo.list.response",
        payload: {
          requestId: msg.requestId,
          projectId: msg.projectId,
          ...result,
          error: null,
        },
      });
    } catch (error) {
      if (msg.subscribe) this.subscribedProjects.delete(msg.projectId);
      this.deps.emit({
        type: "project.todo.list.response",
        payload: {
          requestId: msg.requestId,
          projectId: msg.projectId,
          items: [],
          categories: [],
          error: toProjectTodoWireError(error),
        },
      });
    }
  }

  private async handleItem(
    msg: { requestId: string; projectId: string },
    responseType: ItemResponseType,
    work: (service: ProjectTodoService) => Promise<ProjectTodoDetail>,
  ): Promise<void> {
    const base = { requestId: msg.requestId, projectId: msg.projectId };
    try {
      const item = await work(this.requireService());
      this.emitItem(responseType, { ...base, item, error: null });
    } catch (error) {
      this.emitItem(responseType, {
        ...base,
        item: null,
        error: toProjectTodoWireError(error),
      });
    }
  }

  private emitItem(
    type: ItemResponseType,
    payload: Extract<SessionOutboundMessage, { type: "project.todo.get.response" }>["payload"],
  ): void {
    this.deps.emit({ type, payload } as SessionOutboundMessage);
  }

  private async handleDelete(msg: Inbound<"project.todo.delete.request">): Promise<void> {
    const base = {
      requestId: msg.requestId,
      projectId: msg.projectId,
      todoId: msg.todoId,
    };
    try {
      const deleted = await this.requireService().delete(msg.projectId, msg.todoId);
      this.deps.emit({
        type: "project.todo.delete.response",
        payload: { ...base, deleted, error: null },
      });
    } catch (error) {
      this.deps.emit({
        type: "project.todo.delete.response",
        payload: {
          ...base,
          deleted: false,
          error: toProjectTodoWireError(error),
        },
      });
    }
  }

  private async handleUnsubscribe(msg: Inbound<"project.todo.unsubscribe.request">): Promise<void> {
    this.subscribedProjects.delete(msg.projectId);
    if (this.subscribedProjects.size === 0) {
      this.unsubscribeService?.();
      this.unsubscribeService = null;
    }
    this.deps.emit({
      type: "project.todo.unsubscribe.response",
      payload: {
        requestId: msg.requestId,
        projectId: msg.projectId,
        error: null,
      },
    });
  }
}
