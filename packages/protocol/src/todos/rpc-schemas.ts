import { z } from "zod";
import {
  ProjectTodoDetailSchema,
  ProjectTodoErrorSchema,
  ProjectTodoPrioritySchema,
  ProjectTodoStatusSchema,
  ProjectTodoSummarySchema,
} from "./schemas.js";

// Session RPCs for project to-dos. Gated on `server_info.features.projectTodos`.

export const ProjectTodoListRequestSchema = z.object({
  type: z.literal("project.todo.list.request"),
  requestId: z.string(),
  projectId: z.string(),
  statuses: z.array(ProjectTodoStatusSchema).optional(),
  category: z.string().optional(),
  // When true, this session receives `project.todo.changed` for the project
  // until `project.todo.unsubscribe.request` or disconnect.
  subscribe: z.boolean().optional(),
});

export const ProjectTodoGetRequestSchema = z.object({
  type: z.literal("project.todo.get.request"),
  requestId: z.string(),
  projectId: z.string(),
  todoId: z.string(),
});

export const ProjectTodoCreateRequestSchema = z.object({
  type: z.literal("project.todo.create.request"),
  requestId: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  category: z.string().nullable().optional(),
  priority: ProjectTodoPrioritySchema.optional(),
  status: ProjectTodoStatusSchema.optional(),
  allowParallel: z.boolean().optional(),
  plan: z.string().optional(),
});

export const ProjectTodoUpdateRequestSchema = z.object({
  type: z.literal("project.todo.update.request"),
  requestId: z.string(),
  projectId: z.string(),
  todoId: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  category: z.string().nullable().optional(),
  priority: ProjectTodoPrioritySchema.optional(),
  allowParallel: z.boolean().optional(),
});

export const ProjectTodoUpdatePlanRequestSchema = z.object({
  type: z.literal("project.todo.update_plan.request"),
  requestId: z.string(),
  projectId: z.string(),
  todoId: z.string(),
  plan: z.string(),
});

export const ProjectTodoSetStatusRequestSchema = z.object({
  type: z.literal("project.todo.set_status.request"),
  requestId: z.string(),
  projectId: z.string(),
  todoId: z.string(),
  status: ProjectTodoStatusSchema,
});

/** User force-release. Omit `agentId` to release every claim on the item. */
export const ProjectTodoReleaseRequestSchema = z.object({
  type: z.literal("project.todo.release.request"),
  requestId: z.string(),
  projectId: z.string(),
  todoId: z.string(),
  agentId: z.string().optional(),
});

export const ProjectTodoDeleteRequestSchema = z.object({
  type: z.literal("project.todo.delete.request"),
  requestId: z.string(),
  projectId: z.string(),
  todoId: z.string(),
});

export const ProjectTodoUnsubscribeRequestSchema = z.object({
  type: z.literal("project.todo.unsubscribe.request"),
  requestId: z.string(),
  projectId: z.string(),
});

export const ProjectTodoListResponseSchema = z.object({
  type: z.literal("project.todo.list.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string(),
    items: z.array(ProjectTodoSummarySchema),
    // Every category used by any item in the project, sorted, independent of filters.
    categories: z.array(z.string()),
    error: ProjectTodoErrorSchema.nullable(),
  }),
});

const ProjectTodoItemResponsePayloadSchema = z.object({
  requestId: z.string(),
  projectId: z.string(),
  item: ProjectTodoDetailSchema.nullable(),
  error: ProjectTodoErrorSchema.nullable(),
});

export const ProjectTodoGetResponseSchema = z.object({
  type: z.literal("project.todo.get.response"),
  payload: ProjectTodoItemResponsePayloadSchema,
});
export const ProjectTodoCreateResponseSchema = z.object({
  type: z.literal("project.todo.create.response"),
  payload: ProjectTodoItemResponsePayloadSchema,
});
export const ProjectTodoUpdateResponseSchema = z.object({
  type: z.literal("project.todo.update.response"),
  payload: ProjectTodoItemResponsePayloadSchema,
});
export const ProjectTodoUpdatePlanResponseSchema = z.object({
  type: z.literal("project.todo.update_plan.response"),
  payload: ProjectTodoItemResponsePayloadSchema,
});
export const ProjectTodoSetStatusResponseSchema = z.object({
  type: z.literal("project.todo.set_status.response"),
  payload: ProjectTodoItemResponsePayloadSchema,
});
export const ProjectTodoReleaseResponseSchema = z.object({
  type: z.literal("project.todo.release.response"),
  payload: ProjectTodoItemResponsePayloadSchema,
});

export const ProjectTodoDeleteResponseSchema = z.object({
  type: z.literal("project.todo.delete.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string(),
    todoId: z.string(),
    deleted: z.boolean(),
    error: ProjectTodoErrorSchema.nullable(),
  }),
});

export const ProjectTodoUnsubscribeResponseSchema = z.object({
  type: z.literal("project.todo.unsubscribe.response"),
  payload: z.object({
    requestId: z.string(),
    projectId: z.string(),
    error: ProjectTodoErrorSchema.nullable(),
  }),
});

/** Push event for subscribed sessions; emitted on every daemon-side mutation. */
export const ProjectTodoChangedMessageSchema = z.object({
  type: z.literal("project.todo.changed"),
  payload: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("upsert"),
      projectId: z.string(),
      item: ProjectTodoSummarySchema,
    }),
    z.object({
      kind: z.literal("remove"),
      projectId: z.string(),
      todoId: z.string(),
    }),
  ]),
});

export type ProjectTodoListRequest = z.infer<typeof ProjectTodoListRequestSchema>;
export type ProjectTodoGetRequest = z.infer<typeof ProjectTodoGetRequestSchema>;
export type ProjectTodoCreateRequest = z.infer<typeof ProjectTodoCreateRequestSchema>;
export type ProjectTodoUpdateRequest = z.infer<typeof ProjectTodoUpdateRequestSchema>;
export type ProjectTodoUpdatePlanRequest = z.infer<typeof ProjectTodoUpdatePlanRequestSchema>;
export type ProjectTodoSetStatusRequest = z.infer<typeof ProjectTodoSetStatusRequestSchema>;
export type ProjectTodoReleaseRequest = z.infer<typeof ProjectTodoReleaseRequestSchema>;
export type ProjectTodoDeleteRequest = z.infer<typeof ProjectTodoDeleteRequestSchema>;
export type ProjectTodoUnsubscribeRequest = z.infer<typeof ProjectTodoUnsubscribeRequestSchema>;
export type ProjectTodoListResponse = z.infer<typeof ProjectTodoListResponseSchema>;
export type ProjectTodoGetResponse = z.infer<typeof ProjectTodoGetResponseSchema>;
export type ProjectTodoCreateResponse = z.infer<typeof ProjectTodoCreateResponseSchema>;
export type ProjectTodoUpdateResponse = z.infer<typeof ProjectTodoUpdateResponseSchema>;
export type ProjectTodoUpdatePlanResponse = z.infer<typeof ProjectTodoUpdatePlanResponseSchema>;
export type ProjectTodoSetStatusResponse = z.infer<typeof ProjectTodoSetStatusResponseSchema>;
export type ProjectTodoReleaseResponse = z.infer<typeof ProjectTodoReleaseResponseSchema>;
export type ProjectTodoDeleteResponse = z.infer<typeof ProjectTodoDeleteResponseSchema>;
export type ProjectTodoUnsubscribeResponse = z.infer<typeof ProjectTodoUnsubscribeResponseSchema>;
export type ProjectTodoChangedMessage = z.infer<typeof ProjectTodoChangedMessageSchema>;
