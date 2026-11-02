import { markMoved, setTodoStatus, STATUSES, useTodos, type TodoStatus } from "../../daemon/todos";
import { toast, toastError } from "../toast/store";

/**
 * A move the user made (board arrows, the editor's column): the card marks itself where it lands,
 * and a toast names the column with an Undo, so a card leaving the view is never unexplained.
 */
export async function moveTodo(
  projectId: string,
  todoId: string,
  status: TodoStatus,
): Promise<void> {
  const before = useTodos.getState().items[projectId]?.find((t) => t.id === todoId);
  if (!before || before.status === status) return;
  await setTodoStatus(projectId, todoId, status);
  markMoved(projectId, todoId);
  const label = STATUSES.find((x) => x.value === status)?.label ?? status;
  toast({
    title: `Moved to ${label}`,
    detail: before.title,
    action: {
      label: "Undo",
      onPress: () => {
        void moveTodo(projectId, todoId, before.status).catch((e: unknown) =>
          toastError("Couldn't undo the move", e),
        );
      },
    },
  });
}
