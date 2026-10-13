// Plugin API v2 adapters over host services that are not agents: workspaces.read and
// todos.read / todos.write. Claims stay host-controlled: plugins can read them but never claim,
// release or move a to-do into a claim-bound status.
import type {
  PluginProject,
  PluginTodo,
  PluginTodoDetail,
  PluginWorkspace,
} from "@frogg/protocol/plugins/api-v1";
import {
  PROJECT_TODO_PRIORITIES,
  PROJECT_TODO_STATUSES,
  type ProjectTodoDetail,
  type ProjectTodoPriority,
  type ProjectTodoStatus,
  type ProjectTodoSummary,
} from "@frogg/protocol/todos/schemas";
import type { ProjectTodoService } from "../project-todos/service.js";
import type {
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../workspace-registry.js";
import { PluginServiceError } from "./errors.js";
import type { PluginTodosBridge, PluginWorkspacesBridge } from "./runtime.js";

/** Statuses a plugin may set. "claimed" and "in_progress" follow agent claims. */
const PLUGIN_SETTABLE_STATUSES = new Set<string>(
  PROJECT_TODO_STATUSES.filter((s) => s !== "claimed" && s !== "in_progress"),
);

function projectView(p: PersistedProjectRecord): PluginProject {
  return {
    id: p.projectId,
    name: p.customName ?? p.displayName,
    rootPath: p.rootPath,
  };
}

function workspaceView(w: PersistedWorkspaceRecord): PluginWorkspace {
  return {
    id: w.workspaceId,
    projectId: w.projectId,
    title: w.title ?? w.displayName,
    cwd: w.cwd,
    branch: w.branch ?? null,
    kind: w.kind,
  };
}

export function createPluginWorkspacesBridge(deps: {
  projects: Pick<ProjectRegistry, "list">;
  workspaces: Pick<WorkspaceRegistry, "list" | "get">;
}): PluginWorkspacesBridge {
  return {
    listProjects: async () =>
      (await deps.projects.list()).filter((p) => !p.archivedAt).map(projectView),
    list: async (projectId) =>
      (await deps.workspaces.list())
        .filter((w) => !w.archivedAt && (!projectId || w.projectId === projectId))
        .map(workspaceView),
    get: async (workspaceId) => {
      const w = await deps.workspaces.get(workspaceId);
      return w && !w.archivedAt ? workspaceView(w) : null;
    },
  };
}

function todoView(projectId: string, t: ProjectTodoSummary): PluginTodo {
  return {
    id: t.id,
    projectId,
    title: t.title,
    description: t.description,
    category: t.category,
    priority: t.priority,
    status: t.status,
    claimedBy: t.claims.map((c) => ({ agentId: c.agentId, stale: c.stale })),
    progressCount: t.progressCount,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

function todoDetailView(projectId: string, t: ProjectTodoDetail): PluginTodoDetail {
  return {
    ...todoView(projectId, t),
    progress: t.progress.map((p) => ({
      at: p.at,
      ...(p.agentId ? { agentId: p.agentId } : {}),
      note: p.note,
    })),
    plan: t.plan,
  };
}

function checkPriority(value: unknown): ProjectTodoPriority | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !(PROJECT_TODO_PRIORITIES as readonly string[]).includes(value))
    throw new PluginServiceError(
      "invalid_request",
      `priority must be one of ${PROJECT_TODO_PRIORITIES.join(", ")}`,
    );
  return value as ProjectTodoPriority;
}

function checkSettableStatus(value: unknown): ProjectTodoStatus {
  if (typeof value !== "string" || !PLUGIN_SETTABLE_STATUSES.has(value))
    throw new PluginServiceError(
      "invalid_request",
      `status must be one of ${[...PLUGIN_SETTABLE_STATUSES].join(", ")}; claims belong to agents`,
    );
  return value as ProjectTodoStatus;
}

function rethrow(err: unknown): never {
  if (err instanceof PluginServiceError) throw err;
  const code = (err as { code?: unknown })?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === "todo_not_found" || code === "project_not_found")
    throw new PluginServiceError("not_found", message);
  if (code === "invalid_request") throw new PluginServiceError("invalid_request", message);
  throw err;
}

export function createPluginTodosBridge(deps: { todos: ProjectTodoService }): PluginTodosBridge {
  const { todos } = deps;
  const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      rethrow(err);
    }
  };
  return {
    list: (projectId, filter) =>
      guard(async () => {
        const statuses = filter?.status?.filter((s): s is ProjectTodoStatus =>
          (PROJECT_TODO_STATUSES as readonly string[]).includes(s),
        );
        const { items } = await todos.list(projectId, statuses?.length ? { statuses } : {});
        return items.map((t) => todoView(projectId, t));
      }),
    get: (projectId, todoId) =>
      guard(async () => todoDetailView(projectId, await todos.get(projectId, todoId))),
    subscribe: (listener) =>
      todos.subscribe((change) => {
        if (change.kind === "upsert") {
          listener({
            projectId: change.projectId,
            kind: "upsert",
            todoId: change.item.id,
            todo: todoView(change.projectId, change.item),
          });
        } else {
          listener({
            projectId: change.projectId,
            kind: "remove",
            todoId: change.todoId,
            todo: null,
          });
        }
      }),
    create: (projectId, input) =>
      guard(async () => {
        if (!input || typeof input.title !== "string" || !input.title.trim())
          throw new PluginServiceError("invalid_request", "title is required");
        const priority = checkPriority(input.priority);
        const created = await todos.create(projectId, {
          title: input.title,
          ...(typeof input.description === "string" ? { description: input.description } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(priority ? { priority } : {}),
        });
        return todoView(projectId, created);
      }),
    update: (projectId, todoId, patch) =>
      guard(async () => {
        const priority = checkPriority(patch?.priority);
        const updated = await todos.update(projectId, todoId, {
          ...(typeof patch?.title === "string" ? { title: patch.title } : {}),
          ...(typeof patch?.description === "string" ? { description: patch.description } : {}),
          ...(patch?.category !== undefined ? { category: patch.category } : {}),
          ...(priority ? { priority } : {}),
        });
        return todoView(projectId, updated);
      }),
    setStatus: (projectId, todoId, status, note) =>
      guard(async () =>
        todoView(
          projectId,
          await todos.setStatus(
            projectId,
            todoId,
            checkSettableStatus(status),
            note ? { note } : {},
          ),
        ),
      ),
    addNote: (projectId, todoId, note) =>
      guard(async () => {
        if (typeof note !== "string" || !note.trim())
          throw new PluginServiceError("invalid_request", "note is required");
        await todos.addProgress(projectId, todoId, note);
      }),
  };
}
