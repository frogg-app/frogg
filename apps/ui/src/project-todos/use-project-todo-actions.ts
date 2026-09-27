import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { ProjectTodoDetail, ProjectTodoStatus } from "@frogg/protocol/todos/schemas";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import type { normalizeProjectTodoForm } from "./model";
import {
  projectTodoDetailQueryKey,
  projectTodoListQueryKey,
  unwrapProjectTodoResponse,
} from "./use-project-todos";

type TodoFields = NonNullable<ReturnType<typeof normalizeProjectTodoForm>>;

export type ProjectTodoActionName = "create" | "update" | "plan" | "status" | "release" | "delete";

/**
 * Every to-do mutation, each with a toast on success and failure. Results are
 * written straight into the detail cache; the list follows through the
 * `project.todo.changed` event. Each action resolves `true` on success so a
 * form can close, and `false` so it keeps the user's input.
 */
export function useProjectTodoActions(serverId: string, projectId: string) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<ProjectTodoActionName | null>(null);

  const run = useCallback(
    async (
      name: ProjectTodoActionName,
      successMessage: string,
      action: (client: DaemonClient) => Promise<{ item?: ProjectTodoDetail | null }>,
    ): Promise<string | null> => {
      if (!client) {
        toast.error(t("projectTodos.offline"));
        return null;
      }
      setPending(name);
      try {
        const result = await action(client);
        if (result.item) {
          queryClient.setQueryData(
            projectTodoDetailQueryKey(serverId, projectId, result.item.id),
            result.item,
          );
        }
        toast.show(successMessage, { variant: "success" });
        return result.item?.id ?? "";
      } catch (error) {
        toast.error(t("projectTodos.toast.failed", { message: toErrorMessage(error) }));
        return null;
      } finally {
        setPending(null);
      }
    },
    [client, projectId, queryClient, serverId, t, toast],
  );

  const create = useCallback(
    (fields: TodoFields) =>
      run("create", t("projectTodos.toast.created"), async (c) =>
        unwrapProjectTodoResponse(await c.createProjectTodo({ projectId, ...fields })),
      ),
    [projectId, run, t],
  );

  const update = useCallback(
    async (todoId: string, fields: TodoFields) =>
      (await run("update", t("projectTodos.toast.saved"), async (c) =>
        unwrapProjectTodoResponse(await c.updateProjectTodo({ projectId, todoId, ...fields })),
      )) !== null,
    [projectId, run, t],
  );

  const updatePlan = useCallback(
    async (todoId: string, plan: string) =>
      (await run("plan", t("projectTodos.toast.planSaved"), async (c) =>
        unwrapProjectTodoResponse(await c.updateProjectTodoPlan({ projectId, todoId, plan })),
      )) !== null,
    [projectId, run, t],
  );

  const setStatus = useCallback(
    async (todoId: string, status: ProjectTodoStatus) =>
      (await run("status", t("projectTodos.toast.statusChanged"), async (c) =>
        unwrapProjectTodoResponse(await c.setProjectTodoStatus({ projectId, todoId, status })),
      )) !== null,
    [projectId, run, t],
  );

  const releaseAll = useCallback(
    async (todoId: string, title: string) => {
      const confirmed = await confirmDialog({
        title: t("projectTodos.confirm.releaseTitle"),
        message: t("projectTodos.confirm.releaseMessage", { title }),
        confirmLabel: t("projectTodos.confirm.releaseConfirm"),
        destructive: true,
      });
      if (!confirmed) return false;
      // No agentId: the daemon releases every claim on the item.
      return (
        (await run("release", t("projectTodos.toast.released"), async (c) =>
          unwrapProjectTodoResponse(await c.releaseProjectTodo({ projectId, todoId })),
        )) !== null
      );
    },
    [projectId, run, t],
  );

  const remove = useCallback(
    async (todoId: string, title: string) => {
      const confirmed = await confirmDialog({
        title: t("projectTodos.confirm.deleteTitle"),
        message: t("projectTodos.confirm.deleteMessage", { title }),
        confirmLabel: t("projectTodos.confirm.deleteConfirm"),
        destructive: true,
      });
      if (!confirmed) return false;
      const ok = await run("delete", t("projectTodos.toast.deleted"), async (c) => {
        unwrapProjectTodoResponse(await c.deleteProjectTodo({ projectId, todoId }));
        return {};
      });
      if (ok === null) return false;
      queryClient.removeQueries({
        queryKey: projectTodoDetailQueryKey(serverId, projectId, todoId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectTodoListQueryKey(serverId, projectId),
      });
      return true;
    },
    [projectId, queryClient, run, serverId, t],
  );

  return { pending, create, update, updatePlan, setStatus, releaseAll, remove };
}
