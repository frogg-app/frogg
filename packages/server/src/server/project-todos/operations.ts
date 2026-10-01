// Pure to-do mutations over one in-memory index. The service re-reads the index
// under the project lock, applies one of these, and writes the result back.
import {
  PROJECT_TODO_CATEGORY_MAX,
  PROJECT_TODO_DESCRIPTION_MAX,
  PROJECT_TODO_NOTE_MAX,
  PROJECT_TODO_TITLE_MAX,
  type ProjectTodoClaim,
  type ProjectTodoClaimView,
  type ProjectTodoIndex,
  type ProjectTodoItem,
  type ProjectTodoPriority,
  type ProjectTodoStatus,
  type ProjectTodoSummary,
} from "@frogg/protocol/todos/schemas";

export type ProjectTodoErrorCode =
  | "project_todos_unavailable"
  | "project_not_found"
  | "todo_not_found"
  | "claim_conflict"
  | "takeover_not_allowed"
  | "not_claimed"
  | "invalid_request"
  | "todo_failed";

export class ProjectTodoError extends Error {
  constructor(
    readonly code: ProjectTodoErrorCode,
    message: string,
    readonly claimants?: ProjectTodoClaimView[],
  ) {
    super(message);
  }
}

export type IsAgentRunning = (agentId: string) => boolean;

export interface ProjectTodoClaimant {
  agentId: string;
  sessionId: string | null;
  workspaceId: string | null;
  branch: string | null;
}

export interface CreateTodoInput {
  title: string;
  description?: string;
  category?: string | null;
  priority?: ProjectTodoPriority;
  status?: ProjectTodoStatus;
  allowParallel?: boolean;
}

export interface UpdateTodoInput {
  title?: string;
  description?: string;
  category?: string | null;
  priority?: ProjectTodoPriority;
  allowParallel?: boolean;
}

/** Statuses that only make sense while someone holds a claim. */
const CLAIM_BOUND_STATUSES: ReadonlySet<ProjectTodoStatus> = new Set(["claimed", "in_progress"]);

export function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new ProjectTodoError("invalid_request", "title must not be empty");
  if (trimmed.length > PROJECT_TODO_TITLE_MAX) {
    throw new ProjectTodoError(
      "invalid_request",
      `title must be at most ${PROJECT_TODO_TITLE_MAX} characters`,
    );
  }
  return trimmed;
}

function normalizeDescription(description: string): string {
  if (description.length > PROJECT_TODO_DESCRIPTION_MAX) {
    throw new ProjectTodoError(
      "invalid_request",
      `description must be at most ${PROJECT_TODO_DESCRIPTION_MAX} characters`,
    );
  }
  return description;
}

export function normalizeCategory(category: string | null | undefined): string | null {
  const trimmed = category?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.length > PROJECT_TODO_CATEGORY_MAX) {
    throw new ProjectTodoError(
      "invalid_request",
      `category must be at most ${PROJECT_TODO_CATEGORY_MAX} characters`,
    );
  }
  return trimmed;
}

function normalizeNote(note: string): string {
  const trimmed = note.trim();
  if (!trimmed) throw new ProjectTodoError("invalid_request", "note must not be empty");
  if (trimmed.length > PROJECT_TODO_NOTE_MAX) {
    throw new ProjectTodoError(
      "invalid_request",
      `note must be at most ${PROJECT_TODO_NOTE_MAX} characters`,
    );
  }
  return trimmed;
}

export function findItem(index: ProjectTodoIndex, id: string): ProjectTodoItem {
  const item = index.items.find((candidate) => candidate.id === id);
  if (!item) throw new ProjectTodoError("todo_not_found", `To-do not found: ${id}`);
  return item;
}

export function toClaimViews(
  claims: ProjectTodoClaim[],
  isAgentRunning: IsAgentRunning,
): ProjectTodoClaimView[] {
  return claims.map((claim) => ({
    ...claim,
    stale: !isAgentRunning(claim.agentId),
  }));
}

export function toSummary(
  item: ProjectTodoItem,
  isAgentRunning: IsAgentRunning,
): ProjectTodoSummary {
  const { progress, claims, ...rest } = item;
  return {
    ...rest,
    claims: toClaimViews(claims, isAgentRunning),
    progressCount: progress.length,
    lastProgress: progress.at(-1) ?? null,
  };
}

export function listCategories(index: ProjectTodoIndex): string[] {
  const categories = new Set<string>();
  for (const item of index.items) {
    if (item.category) categories.add(item.category);
  }
  return [...categories].sort((a, b) => a.localeCompare(b));
}

export function createItem(
  index: ProjectTodoIndex,
  id: string,
  input: CreateTodoInput,
  now: string,
): ProjectTodoItem {
  const status = input.status ?? "backlog";
  if (CLAIM_BOUND_STATUSES.has(status)) {
    throw new ProjectTodoError("invalid_request", `A new to-do cannot start as ${status}`);
  }
  const item: ProjectTodoItem = {
    id,
    title: normalizeTitle(input.title),
    description: normalizeDescription(input.description ?? ""),
    category: normalizeCategory(input.category),
    priority: input.priority ?? "medium",
    status,
    allowParallel: input.allowParallel ?? false,
    claims: [],
    progress: [],
    createdAt: now,
    updatedAt: now,
    planUpdatedAt: null,
  };
  index.items.push(item);
  return item;
}

export function updateItem(item: ProjectTodoItem, input: UpdateTodoInput, now: string): void {
  if (input.title !== undefined) item.title = normalizeTitle(input.title);
  if (input.description !== undefined) item.description = normalizeDescription(input.description);
  if (input.category !== undefined) item.category = normalizeCategory(input.category);
  if (input.priority !== undefined) item.priority = input.priority;
  if (input.allowParallel !== undefined) item.allowParallel = input.allowParallel;
  item.updatedAt = now;
}

/**
 * Compare-and-set claim. Re-claiming by the same agent refreshes its heartbeat.
 * Another agent's claim blocks unless the item allows parallel work, or the
 * caller asks for `takeover` and every other claim is stale.
 */
export function claimItem(
  item: ProjectTodoItem,
  claimant: ProjectTodoClaimant,
  options: { takeover?: boolean; isAgentRunning: IsAgentRunning; now: string },
): { tookOverFrom: string[] } {
  const { now, isAgentRunning } = options;
  if (item.status === "done") {
    throw new ProjectTodoError("invalid_request", "A done to-do cannot be claimed");
  }
  const own = item.claims.find((claim) => claim.agentId === claimant.agentId);
  if (own) {
    own.sessionId = claimant.sessionId ?? own.sessionId;
    own.workspaceId = claimant.workspaceId ?? own.workspaceId;
    own.branch = claimant.branch ?? own.branch;
    own.lastHeartbeat = now;
    item.updatedAt = now;
    return { tookOverFrom: [] };
  }

  const others = item.claims;
  let tookOverFrom: string[] = [];
  if (others.length > 0 && !item.allowParallel) {
    const views = toClaimViews(others, isAgentRunning);
    if (!options.takeover) {
      throw new ProjectTodoError(
        "claim_conflict",
        `To-do ${item.id} is claimed by ${describeClaimants(views)}`,
        views,
      );
    }
    if (views.some((view) => !view.stale)) {
      throw new ProjectTodoError(
        "takeover_not_allowed",
        `To-do ${item.id} is claimed by a running agent; takeover only replaces stale claims`,
        views,
      );
    }
    tookOverFrom = others.map((claim) => claim.agentId);
    item.claims = [];
    item.progress.push({
      at: now,
      agentId: claimant.agentId,
      note: `Took over stale claim from ${tookOverFrom.join(", ")}`,
    });
  }

  item.claims.push({
    agentId: claimant.agentId,
    sessionId: claimant.sessionId,
    workspaceId: claimant.workspaceId,
    branch: claimant.branch,
    claimedAt: now,
    lastHeartbeat: now,
  });
  if (item.status === "backlog" || item.status === "ready") item.status = "claimed";
  item.updatedAt = now;
  return { tookOverFrom };
}

function describeClaimants(views: ProjectTodoClaimView[]): string {
  return views
    .map(
      (view) =>
        `agent ${view.agentId}` +
        (view.workspaceId ? ` in workspace ${view.workspaceId}` : "") +
        (view.stale ? " (stale)" : ""),
    )
    .join(", ");
}

/**
 * Removes claims (one agent's, or all when agentId is omitted). Returns whether
 * anything changed. An item left unclaimed in a claim-bound status returns to ready.
 */
export function releaseItem(
  item: ProjectTodoItem,
  agentId: string | undefined,
  now: string,
): boolean {
  const before = item.claims.length;
  item.claims = agentId ? item.claims.filter((claim) => claim.agentId !== agentId) : [];
  if (item.claims.length === before) return false;
  if (item.claims.length === 0 && CLAIM_BOUND_STATUSES.has(item.status)) item.status = "ready";
  item.updatedAt = now;
  return true;
}

export function setItemStatus(item: ProjectTodoItem, status: ProjectTodoStatus, now: string): void {
  item.status = status;
  if (status === "done") item.claims = [];
  item.updatedAt = now;
}

export function appendProgress(
  item: ProjectTodoItem,
  note: string,
  agentId: string | undefined,
  now: string,
): void {
  item.progress.push({
    at: now,
    ...(agentId ? { agentId } : {}),
    note: normalizeNote(note),
  });
  const own = agentId ? item.claims.find((claim) => claim.agentId === agentId) : undefined;
  if (own) own.lastHeartbeat = now;
  item.updatedAt = now;
}
