// Daemon-owned project to-do service. Resolves a project to its main checkout
// root, serializes every mutation per root, re-reads the index before each
// mutation, and notifies subscribers after each committed change.
import { randomBytes } from "node:crypto";
import path from "node:path";
import {
  PROJECT_TODO_PLAN_MAX,
  type ProjectTodoDetail,
  type ProjectTodoIndex,
  type ProjectTodoItem,
  type ProjectTodoStatus,
  type ProjectTodoSummary,
} from "@frogg/protocol/todos/schemas";
import type { Logger } from "pino";
import type {
  PersistedProjectRecord,
  PersistedWorkspaceRecord,
  ProjectRegistry,
  WorkspaceRegistry,
} from "../workspace-registry.js";
import {
  ProjectTodoError,
  appendProgress,
  claimItem,
  createItem,
  findItem,
  listCategories,
  normalizeCategory,
  releaseItem,
  setItemStatus,
  toSummary,
  updateItem,
  type CreateTodoInput,
  type IsAgentRunning,
  type ProjectTodoClaimant,
  type UpdateTodoInput,
} from "./operations.js";
import { ProjectTodoStore, isValidTodoId } from "./store.js";

export type ProjectTodoChange =
  | { kind: "upsert"; projectId: string; item: ProjectTodoSummary }
  | { kind: "remove"; projectId: string; todoId: string };

export interface ProjectTodoListFilter {
  statuses?: ProjectTodoStatus[];
  category?: string;
}

export interface ProjectTodoServiceDependencies {
  projectRegistry: Pick<ProjectRegistry, "get">;
  workspaceRegistry: Pick<WorkspaceRegistry, "get" | "list">;
  isAgentRunning: IsAgentRunning;
  /** Project ids an agent could hold claims in; used when the agent is archived. */
  resolveAgentProjectIds?: (agentId: string) => Promise<string[]>;
  logger: Logger;
  now?: () => string;
  generateId?: () => string;
}

function defaultGenerateId(): string {
  return `t${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

/**
 * The directory that owns a project's to-dos: the main repository root for git
 * projects (worktrees resolve to their main checkout), otherwise the checkout
 * root. Never a worktree directory.
 */
export function resolveProjectTodoRoot(
  project: PersistedProjectRecord,
  workspaces: PersistedWorkspaceRecord[],
): string {
  const own = workspaces
    .filter((workspace) => workspace.projectId === project.projectId)
    .sort((a, b) => Number(a.archivedAt !== null) - Number(b.archivedAt !== null));
  const mainRoot = own.find((workspace) => workspace.mainRepoRoot)?.mainRepoRoot;
  const checkoutRoot = own.find((workspace) => workspace.kind === "local_checkout");
  const candidate = mainRoot ?? checkoutRoot?.worktreeRoot ?? checkoutRoot?.cwd ?? project.rootPath;
  const resolved = path.resolve(candidate);
  const worktreeRoots = new Set(
    own
      .filter((workspace) => workspace.kind === "worktree")
      .flatMap((workspace) => [workspace.worktreeRoot, workspace.cwd])
      .filter((value): value is string => Boolean(value))
      .map((value) => path.resolve(value)),
  );
  if (worktreeRoots.has(resolved)) {
    throw new ProjectTodoError(
      "project_todos_unavailable",
      `Cannot resolve the main checkout for project ${project.projectId}`,
    );
  }
  return resolved;
}

export class ProjectTodoService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<(change: ProjectTodoChange) => void>();
  /** Roots touched in this process, keyed by root, valued by project id. */
  private readonly knownRoots = new Map<string, string>();
  private readonly now: () => string;
  private readonly generateId: () => string;

  constructor(private readonly deps: ProjectTodoServiceDependencies) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.generateId = deps.generateId ?? defaultGenerateId;
  }

  subscribe(listener: (change: ProjectTodoChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async resolveRoot(projectId: string): Promise<string> {
    const project = await this.deps.projectRegistry.get(projectId);
    if (!project) {
      throw new ProjectTodoError("project_not_found", `Project not found: ${projectId}`);
    }
    const root = resolveProjectTodoRoot(project, await this.deps.workspaceRegistry.list());
    this.knownRoots.set(root, projectId);
    return root;
  }

  /** Project id for a workspace, used to infer the project from an MCP caller. */
  async projectIdForWorkspace(workspaceId: string): Promise<string> {
    const workspace = await this.deps.workspaceRegistry.get(workspaceId);
    if (!workspace) {
      throw new ProjectTodoError("project_not_found", `Workspace not found: ${workspaceId}`);
    }
    return workspace.projectId;
  }

  async list(
    projectId: string,
    filter: ProjectTodoListFilter = {},
  ): Promise<{ items: ProjectTodoSummary[]; categories: string[] }> {
    const store = new ProjectTodoStore(await this.resolveRoot(projectId));
    const index = await store.readIndex();
    const category = filter.category === undefined ? undefined : normalizeCategory(filter.category);
    const statuses = filter.statuses?.length ? new Set(filter.statuses) : null;
    const items = index.items
      .filter((item) => (statuses ? statuses.has(item.status) : true))
      .filter((item) => (category === undefined ? true : item.category === category))
      .map((item) => toSummary(item, this.deps.isAgentRunning));
    return { items, categories: listCategories(index) };
  }

  async get(projectId: string, todoId: string): Promise<ProjectTodoDetail> {
    const store = new ProjectTodoStore(await this.resolveRoot(projectId));
    const item = findItem(await store.readIndex(), todoId);
    return this.toDetail(store, item);
  }

  async create(
    projectId: string,
    input: CreateTodoInput & { plan?: string },
  ): Promise<ProjectTodoDetail> {
    return this.mutate(projectId, async (index, store) => {
      const now = this.now();
      let id = this.generateId();
      while (index.items.some((item) => item.id === id)) id = this.generateId();
      if (!isValidTodoId(id)) throw new ProjectTodoError("todo_failed", "Generated invalid id");
      const item = createItem(index, id, input, now);
      if (input.plan !== undefined && input.plan.length > 0) {
        await this.writePlan(store, item, input.plan, now);
      }
      return item;
    });
  }

  async update(projectId: string, todoId: string, input: UpdateTodoInput) {
    return this.mutate(projectId, (index) => {
      const item = findItem(index, todoId);
      updateItem(item, input, this.now());
      return item;
    });
  }

  async updatePlan(projectId: string, todoId: string, plan: string) {
    return this.mutate(projectId, async (index, store) => {
      const item = findItem(index, todoId);
      await this.writePlan(store, item, plan, this.now());
      return item;
    });
  }

  async setStatus(
    projectId: string,
    todoId: string,
    status: ProjectTodoStatus,
    options: { agentId?: string; note?: string } = {},
  ) {
    return this.mutate(projectId, (index) => {
      const item = findItem(index, todoId);
      const now = this.now();
      if (options.note?.trim()) appendProgress(item, options.note, options.agentId, now);
      setItemStatus(item, status, now);
      return item;
    });
  }

  async claim(
    projectId: string,
    todoId: string,
    claimant: ProjectTodoClaimant,
    options: { takeover?: boolean } = {},
  ) {
    return this.mutate(projectId, (index) => {
      const item = findItem(index, todoId);
      claimItem(item, claimant, {
        takeover: options.takeover,
        isAgentRunning: this.deps.isAgentRunning,
        now: this.now(),
      });
      return item;
    });
  }

  /** Releases one agent's claim (or all claims when agentId is omitted). */
  async release(
    projectId: string,
    todoId: string,
    agentId?: string,
    options: { requireClaim?: boolean } = {},
  ) {
    return this.mutate(projectId, (index) => {
      const item = findItem(index, todoId);
      const changed = releaseItem(item, agentId, this.now());
      if (!changed && options.requireClaim) {
        throw new ProjectTodoError("not_claimed", `To-do ${todoId} is not claimed by ${agentId}`);
      }
      return changed ? item : { unchanged: item };
    });
  }

  async addProgress(projectId: string, todoId: string, note: string, agentId?: string) {
    return this.mutate(projectId, (index) => {
      const item = findItem(index, todoId);
      appendProgress(item, note, agentId, this.now());
      return item;
    });
  }

  async delete(projectId: string, todoId: string): Promise<boolean> {
    const root = await this.resolveRoot(projectId);
    return this.withLock(root, async () => {
      const store = new ProjectTodoStore(root);
      const index = await store.readIndex();
      const next = index.items.filter((item) => item.id !== todoId);
      if (next.length === index.items.length) return false;
      await store.writeIndex({ ...index, items: next });
      await store.deletePlan(todoId);
      this.notify({ kind: "remove", projectId, todoId });
      return true;
    });
  }

  /** Releases every claim an archived agent holds. Errors are logged, never thrown. */
  async releaseAgent(agentId: string): Promise<void> {
    const projectIds = new Set(this.knownRoots.values());
    try {
      for (const projectId of (await this.deps.resolveAgentProjectIds?.(agentId)) ?? []) {
        projectIds.add(projectId);
      }
    } catch (error) {
      this.deps.logger.warn({ err: error, agentId }, "Failed to resolve archived agent projects");
    }
    for (const projectId of projectIds) {
      try {
        await this.releaseAgentInProject(projectId, agentId);
      } catch (error) {
        this.deps.logger.warn(
          { err: error, agentId, projectId },
          "Failed to release archived agent to-do claims",
        );
      }
    }
  }

  private async releaseAgentInProject(projectId: string, agentId: string): Promise<void> {
    const root = await this.resolveRoot(projectId);
    await this.withLock(root, async () => {
      const store = new ProjectTodoStore(root);
      const index = await store.readIndex();
      const now = this.now();
      const changed = index.items.filter((item) => {
        if (!item.claims.some((claim) => claim.agentId === agentId)) return false;
        const released = releaseItem(item, agentId, now);
        if (released)
          item.progress.push({
            at: now,
            agentId,
            note: "Claim released: agent archived",
          });
        return released;
      });
      if (changed.length === 0) return;
      await store.writeIndex(index);
      for (const item of changed) this.notifyUpsert(projectId, item);
    });
  }

  private async mutate(
    projectId: string,
    apply: (
      index: ProjectTodoIndex,
      store: ProjectTodoStore,
    ) =>
      | ProjectTodoItem
      | { unchanged: ProjectTodoItem }
      | Promise<ProjectTodoItem | { unchanged: ProjectTodoItem }>,
  ): Promise<ProjectTodoDetail> {
    const root = await this.resolveRoot(projectId);
    return this.withLock(root, async () => {
      const store = new ProjectTodoStore(root);
      const index = await store.readIndex();
      const result = await apply(index, store);
      if ("unchanged" in result) return this.toDetail(store, result.unchanged);
      await store.writeIndex(index);
      this.notifyUpsert(projectId, result);
      return this.toDetail(store, result);
    });
  }

  private async writePlan(
    store: ProjectTodoStore,
    item: ProjectTodoItem,
    plan: string,
    now: string,
  ): Promise<void> {
    if (plan.length > PROJECT_TODO_PLAN_MAX) {
      throw new ProjectTodoError(
        "invalid_request",
        `plan must be at most ${PROJECT_TODO_PLAN_MAX} characters`,
      );
    }
    await store.writePlan(item.id, plan);
    item.planUpdatedAt = now;
    item.updatedAt = now;
  }

  private async toDetail(
    store: ProjectTodoStore,
    item: ProjectTodoItem,
  ): Promise<ProjectTodoDetail> {
    return {
      ...toSummary(item, this.deps.isAgentRunning),
      progress: item.progress,
      plan: await store.readPlan(item.id),
    };
  }

  private notifyUpsert(projectId: string, item: ProjectTodoItem): void {
    this.notify({
      kind: "upsert",
      projectId,
      item: toSummary(item, this.deps.isAgentRunning),
    });
  }

  private notify(change: ProjectTodoChange): void {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch (error) {
        this.deps.logger.warn({ err: error }, "Project to-do listener failed");
      }
    }
  }

  private async withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    const tail = run.catch(() => undefined);
    this.locks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}
