// Project to-do MCP tools. The caller's identity (agent, session, workspace,
// branch) and the project come from the MCP caller context, never from args.
import { z } from "zod";
import {
  PROJECT_TODO_NOTE_MAX,
  ProjectTodoPrioritySchema,
  ProjectTodoStatusSchema,
} from "@frogg/protocol/todos/schemas";
import { ensureValidJson } from "../../json-utils.js";
import type { AgentManager } from "../agent-manager.js";
import type { WorkspaceRegistry } from "../../workspace-registry.js";
import { ProjectTodoError } from "../../project-todos/operations.js";
import type { ProjectTodoService } from "../../project-todos/service.js";
import type { FroggToolConfig, FroggToolExecutionContext, FroggToolResult } from "./types.js";

export const PROJECT_TODO_TOOL_NAMES = [
  "todo_list",
  "todo_get",
  "todo_create",
  "todo_update",
  "todo_update_plan",
  "todo_claim",
  "todo_release",
  "todo_progress",
  "todo_set_status",
] as const;

type RegisterTool = (
  name: string,
  config: FroggToolConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Tool handlers are schema-validated at registration boundaries.
  handler: (input: any, context: FroggToolExecutionContext) => Promise<FroggToolResult>,
) => void;

export interface TodoToolDependencies {
  registerTool: RegisterTool;
  projectTodos: ProjectTodoService;
  agentManager: Pick<AgentManager, "getAgent">;
  workspaceRegistry?: Pick<WorkspaceRegistry, "get">;
  callerAgentId?: string;
}

interface TodoCaller {
  projectId: string;
  agentId: string;
  sessionId: string | null;
  workspaceId: string;
  branch: string | null;
}

function ok(value: unknown): FroggToolResult {
  return { content: [], structuredContent: ensureValidJson(value) };
}

/** Structured tool error so a caller sees who holds a claim and where to check progress. */
function todoErrorResult(error: ProjectTodoError): FroggToolResult {
  const payload = {
    error: {
      code: error.code,
      message: error.message,
      ...(error.claimants ? { claimants: error.claimants } : {}),
    },
  };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: ensureValidJson(payload),
    isError: true,
  };
}

async function run(work: () => Promise<unknown>): Promise<FroggToolResult> {
  try {
    return ok(await work());
  } catch (error) {
    if (error instanceof ProjectTodoError) return todoErrorResult(error);
    throw error;
  }
}

export function registerTodoTools(deps: TodoToolDependencies): void {
  const { registerTool, projectTodos, agentManager, callerAgentId } = deps;

  const resolveCaller = async (): Promise<TodoCaller> => {
    if (!callerAgentId) {
      throw new ProjectTodoError(
        "invalid_request",
        "Project to-do tools are only available to agents running in a Frogg workspace",
      );
    }
    const agent = agentManager.getAgent(callerAgentId);
    if (!agent?.workspaceId) {
      throw new ProjectTodoError(
        "project_not_found",
        `Caller agent ${callerAgentId} has no current workspace`,
      );
    }
    const workspace = (await deps.workspaceRegistry?.get(agent.workspaceId)) ?? null;
    const projectId =
      workspace?.projectId ?? (await projectTodos.projectIdForWorkspace(agent.workspaceId));
    return {
      projectId,
      agentId: callerAgentId,
      sessionId: agent.persistence?.sessionId ?? null,
      workspaceId: agent.workspaceId,
      branch: workspace?.branch ?? null,
    };
  };

  const todoId = z.string().describe("To-do id from todo_list");

  registerTool(
    "todo_list",
    {
      title: "List project to-dos",
      description:
        "List the to-dos of the project your workspace belongs to. Claims show `stale: true` when the claiming agent is no longer running. Returns the categories in use.",
      inputSchema: {
        status: z.array(ProjectTodoStatusSchema).optional().describe("Only include these statuses"),
        category: z.string().optional().describe("Only include this category"),
      },
    },
    async ({ status, category }) =>
      run(async () => {
        const caller = await resolveCaller();
        return {
          projectId: caller.projectId,
          ...(await projectTodos.list(caller.projectId, {
            statuses: status,
            category,
          })),
        };
      }),
  );

  registerTool(
    "todo_get",
    {
      title: "Get project to-do",
      description: "Get one to-do with its markdown plan, progress log and claim state.",
      inputSchema: { todoId },
    },
    async ({ todoId: id }) =>
      run(async () => ({
        item: await projectTodos.get((await resolveCaller()).projectId, id),
      })),
  );

  registerTool(
    "todo_create",
    {
      title: "Create project to-do",
      description: "Create a to-do in your project. Optionally attach a markdown plan.",
      inputSchema: {
        title: z.string(),
        description: z.string().optional(),
        category: z.string().optional().describe("Free-form category; reuse ones from todo_list"),
        priority: ProjectTodoPrioritySchema.optional(),
        status: z.enum(["backlog", "ready", "review", "done", "blocked"]).optional(),
        allowParallel: z
          .boolean()
          .optional()
          .describe("Let several agents claim it at once (default false)"),
        plan: z.string().optional().describe("Markdown plan"),
      },
    },
    async (input) =>
      run(async () => ({
        item: await projectTodos.create((await resolveCaller()).projectId, input),
      })),
  );

  registerTool(
    "todo_update",
    {
      title: "Update project to-do",
      description: "Update a to-do's title, description, category, priority or allowParallel.",
      inputSchema: {
        todoId,
        title: z.string().optional(),
        description: z.string().optional(),
        category: z.string().nullable().optional().describe("Empty or null clears the category"),
        priority: ProjectTodoPrioritySchema.optional(),
        allowParallel: z.boolean().optional(),
      },
    },
    async ({ todoId: id, ...input }) =>
      run(async () => ({
        item: await projectTodos.update((await resolveCaller()).projectId, id, input),
      })),
  );

  registerTool(
    "todo_update_plan",
    {
      title: "Update to-do plan",
      description: "Replace a to-do's markdown plan.",
      inputSchema: { todoId, plan: z.string() },
    },
    async ({ todoId: id, plan }) =>
      run(async () => ({
        item: await projectTodos.updatePlan((await resolveCaller()).projectId, id, plan),
      })),
  );

  registerTool(
    "todo_claim",
    {
      title: "Claim project to-do",
      description:
        "Claim a to-do for yourself before working on it. Fails with `claim_conflict` (listing the current claimants' agentId, sessionId and workspaceId) when another agent holds it and it does not allow parallel work. Claiming again refreshes your heartbeat. Pass takeover: true to replace claims that are all stale.",
      inputSchema: {
        todoId,
        takeover: z
          .boolean()
          .optional()
          .describe("Replace existing claims; only succeeds when every one is stale"),
      },
    },
    async ({ todoId: id, takeover }) =>
      run(async () => {
        const caller = await resolveCaller();
        return {
          item: await projectTodos.claim(caller.projectId, id, caller, {
            takeover,
          }),
        };
      }),
  );

  registerTool(
    "todo_release",
    {
      title: "Release project to-do",
      description: "Release your claim on a to-do without finishing it.",
      inputSchema: { todoId },
    },
    async ({ todoId: id }) =>
      run(async () => {
        const caller = await resolveCaller();
        return {
          item: await projectTodos.release(caller.projectId, id, caller.agentId, {
            requireClaim: true,
          }),
        };
      }),
  );

  registerTool(
    "todo_progress",
    {
      title: "Record to-do progress",
      description: "Append a progress note to a to-do. Also refreshes your claim heartbeat.",
      inputSchema: { todoId, note: z.string().max(PROJECT_TODO_NOTE_MAX) },
    },
    async ({ todoId: id, note }) =>
      run(async () => {
        const caller = await resolveCaller();
        return {
          item: await projectTodos.addProgress(caller.projectId, id, note, caller.agentId),
        };
      }),
  );

  registerTool(
    "todo_set_status",
    {
      title: "Set to-do status",
      description:
        "Move a to-do to another status. Setting done releases every claim. An optional note is appended to the progress log.",
      inputSchema: {
        todoId,
        status: ProjectTodoStatusSchema,
        note: z.string().max(PROJECT_TODO_NOTE_MAX).optional(),
      },
    },
    async ({ todoId: id, status, note }) =>
      run(async () => {
        const caller = await resolveCaller();
        return {
          item: await projectTodos.setStatus(caller.projectId, id, status, {
            agentId: caller.agentId,
            note,
          }),
        };
      }),
  );
}
