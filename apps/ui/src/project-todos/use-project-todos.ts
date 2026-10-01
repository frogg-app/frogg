import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { ProjectTodoError } from "@frogg/protocol/todos/schemas";
import { useFetchQuery } from "@/data/query";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { applyProjectTodoChange, type ProjectTodoListState } from "./model";

/** A structured daemon error, kept whole so callers can show claimants on a conflict. */
export class ProjectTodoRequestError extends Error {
  readonly code: string;
  readonly claimants: ProjectTodoError["claimants"];
  constructor(error: ProjectTodoError) {
    super(error.message);
    this.name = "ProjectTodoRequestError";
    this.code = error.code;
    this.claimants = error.claimants;
  }
}

/** Unwraps a to-do response: its `error` becomes a thrown `ProjectTodoRequestError`. */
export function unwrapProjectTodoResponse<T extends { error: ProjectTodoError | null }>(
  payload: T,
): T {
  if (payload.error) throw new ProjectTodoRequestError(payload.error);
  return payload;
}

export function projectTodoListQueryKey(serverId: string, projectId: string) {
  return ["projectTodos", serverId, projectId, "list"] as const;
}

export function projectTodoDetailQueryKey(serverId: string, projectId: string, todoId: string) {
  return ["projectTodos", serverId, projectId, "detail", todoId] as const;
}

export function useProjectTodosSupported(serverId: string): boolean {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.projectTodos === true,
  );
}

async function fetchList(client: DaemonClient, projectId: string): Promise<ProjectTodoListState> {
  const payload = unwrapProjectTodoResponse(
    await client.listProjectTodos({ projectId, subscribe: true }),
  );
  return { items: payload.items, categories: payload.categories };
}

/**
 * The project's to-do list, kept live. Listing subscribes this session to
 * `project.todo.changed`; the events fold into the cached list and the open
 * detail query. A reconnect re-lists (the daemon drops subscriptions with the
 * socket), and unmount unsubscribes.
 */
export function useProjectTodoList(serverId: string, projectId: string) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useProjectTodosSupported(serverId);
  const queryClient = useQueryClient();
  const queryKey = projectTodoListQueryKey(serverId, projectId);
  const enabled = Boolean(client) && isConnected && supported && projectId.length > 0;

  const query = useFetchQuery({
    dataShape: "value",
    queryKey,
    queryFn: () => {
      if (!client) throw new Error("no client");
      return fetchList(client, projectId);
    },
    enabled,
    // Live through push events; the stale time only bounds refocus re-lists.
    // Mounting always re-lists, which is also what re-subscribes after unmount.
    staleTimeMs: 60_000,
  });

  const wasConnected = useRef(isConnected);
  useEffect(() => {
    if (isConnected && !wasConnected.current) {
      void queryClient.invalidateQueries({
        queryKey: projectTodoListQueryKey(serverId, projectId),
      });
    }
    wasConnected.current = isConnected;
  }, [isConnected, projectId, queryClient, serverId]);

  useEffect(() => {
    if (!client || !supported) return undefined;
    const off = client.on("project.todo.changed", (message) => {
      const change = message.payload;
      if (change.projectId !== projectId) return;
      queryClient.setQueryData<ProjectTodoListState>(
        projectTodoListQueryKey(serverId, projectId),
        (prev) => (prev ? applyProjectTodoChange(prev, projectId, change) : prev),
      );
      const todoId = change.kind === "remove" ? change.todoId : change.item.id;
      // The event carries a summary; the detail (plan, progress) is refetched.
      void queryClient.invalidateQueries({
        queryKey: projectTodoDetailQueryKey(serverId, projectId, todoId),
      });
    });
    return () => {
      off();
      void client.unsubscribeProjectTodos({ projectId }).catch(() => undefined);
    };
  }, [client, projectId, queryClient, serverId, supported]);

  return { query, client, isConnected, supported };
}

export function useProjectTodoDetail(serverId: string, projectId: string, todoId: string | null) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  return useFetchQuery({
    dataShape: "value",
    staleTimeMs: 30_000,
    queryKey: projectTodoDetailQueryKey(serverId, projectId, todoId ?? ""),
    queryFn: async () => {
      if (!client || !todoId) throw new Error("no client");
      const payload = unwrapProjectTodoResponse(await client.getProjectTodo({ projectId, todoId }));
      return payload.item;
    },
    enabled: Boolean(client) && isConnected && Boolean(todoId),
  });
}
