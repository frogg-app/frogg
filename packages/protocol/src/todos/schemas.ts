import { z } from "zod";

// Project to-do domain schemas. Shared by the daemon store, the session RPCs,
// the agent MCP tools and any client surface (for example a kanban board). The
// status enum doubles as the board's column set, in display order.

export const PROJECT_TODO_STATUSES = [
  "backlog",
  "ready",
  "claimed",
  "in_progress",
  "review",
  "done",
  "blocked",
] as const;
export const ProjectTodoStatusSchema = z.enum(PROJECT_TODO_STATUSES);
export type ProjectTodoStatus = z.infer<typeof ProjectTodoStatusSchema>;

export const PROJECT_TODO_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const ProjectTodoPrioritySchema = z.enum(PROJECT_TODO_PRIORITIES);
export type ProjectTodoPriority = z.infer<typeof ProjectTodoPrioritySchema>;

export const PROJECT_TODO_TITLE_MAX = 200;
export const PROJECT_TODO_DESCRIPTION_MAX = 20_000;
export const PROJECT_TODO_CATEGORY_MAX = 64;
export const PROJECT_TODO_NOTE_MAX = 4_000;
export const PROJECT_TODO_PLAN_MAX = 200_000;

export const ProjectTodoClaimSchema = z.object({
  agentId: z.string(),
  sessionId: z.string().nullable(),
  workspaceId: z.string().nullable(),
  branch: z.string().nullable(),
  claimedAt: z.string(),
  lastHeartbeat: z.string(),
});
export type ProjectTodoClaim = z.infer<typeof ProjectTodoClaimSchema>;

/** A claim as projected to readers: `stale` means the claiming agent is no longer running. */
export const ProjectTodoClaimViewSchema = ProjectTodoClaimSchema.extend({
  stale: z.boolean(),
});
export type ProjectTodoClaimView = z.infer<typeof ProjectTodoClaimViewSchema>;

export const ProjectTodoProgressEntrySchema = z.object({
  at: z.string(),
  agentId: z.string().optional(),
  note: z.string(),
});
export type ProjectTodoProgressEntry = z.infer<typeof ProjectTodoProgressEntrySchema>;

/** The persisted item shape stored in `.frogg/todos/index.json`. */
export const ProjectTodoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  priority: ProjectTodoPrioritySchema,
  status: ProjectTodoStatusSchema,
  allowParallel: z.boolean(),
  claims: z.array(ProjectTodoClaimSchema),
  progress: z.array(ProjectTodoProgressEntrySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
  planUpdatedAt: z.string().nullable(),
});
export type ProjectTodoItem = z.infer<typeof ProjectTodoItemSchema>;

export const ProjectTodoIndexSchema = z.object({
  version: z.literal(1),
  items: z.array(ProjectTodoItemSchema),
});
export type ProjectTodoIndex = z.infer<typeof ProjectTodoIndexSchema>;

/** List projection: no plan body and no progress log, only their counts/timestamps. */
export const ProjectTodoSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  priority: ProjectTodoPrioritySchema,
  status: ProjectTodoStatusSchema,
  allowParallel: z.boolean(),
  claims: z.array(ProjectTodoClaimViewSchema),
  progressCount: z.number().int().nonnegative(),
  lastProgress: ProjectTodoProgressEntrySchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  planUpdatedAt: z.string().nullable(),
});
export type ProjectTodoSummary = z.infer<typeof ProjectTodoSummarySchema>;

/** Detail projection: the summary plus the full progress log and the markdown plan. */
export const ProjectTodoDetailSchema = ProjectTodoSummarySchema.extend({
  progress: z.array(ProjectTodoProgressEntrySchema),
  plan: z.string().nullable(),
});
export type ProjectTodoDetail = z.infer<typeof ProjectTodoDetailSchema>;

export const PROJECT_TODO_ERROR_CODES = [
  "project_todos_unavailable",
  "project_not_found",
  "todo_not_found",
  "claim_conflict",
  "takeover_not_allowed",
  "not_claimed",
  "invalid_request",
  "todo_failed",
] as const;

/**
 * Structured error. `code` is an open string so later daemons can add codes;
 * known values are listed in PROJECT_TODO_ERROR_CODES. On `claim_conflict`,
 * `claimants` names who holds the item so the caller knows where to look.
 */
export const ProjectTodoErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  claimants: z.array(ProjectTodoClaimViewSchema).optional(),
});
export type ProjectTodoError = z.infer<typeof ProjectTodoErrorSchema>;
