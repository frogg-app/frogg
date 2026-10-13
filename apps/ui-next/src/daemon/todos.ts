import { create } from "zustand";
import { getClient, listProjects, onHostSwitch, type Project } from "./store";

type Client = NonNullable<ReturnType<typeof getClient>>;
export type Todo = Awaited<ReturnType<Client["listProjectTodos"]>>["items"][number];
export type TodoStatus = Todo["status"];
export type TodoPriority = Todo["priority"];
type CreateInput = Omit<Parameters<Client["createProjectTodo"]>[0], "requestId" | "projectId">;
type UpdateInput = Omit<
  Parameters<Client["updateProjectTodo"]>[0],
  "requestId" | "projectId" | "todoId"
>;

/** Board columns in display order (the daemon's status enum doubles as the column set). */
export const STATUSES: Array<{ value: TodoStatus; label: string; hint: string }> = [
  { value: "backlog", label: "Backlog", hint: "Written down, not ready to start" },
  { value: "ready", label: "Ready", hint: "Agents may claim these" },
  { value: "claimed", label: "Claimed", hint: "An agent has taken it" },
  { value: "in_progress", label: "In progress", hint: "Being worked on" },
  { value: "review", label: "Review", hint: "Waiting for you" },
  { value: "done", label: "Done", hint: "Finished" },
  { value: "blocked", label: "Blocked", hint: "Stuck on something" },
];

export const PRIORITIES: Array<{ value: TodoPriority; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

interface TodoState {
  /** Projects on the host, or null while loading. */
  projects: Project[] | null;
  /** Items per project id; null while that project loads. */
  items: Record<string, Todo[] | null>;
  /** A load or mutation error per project id. */
  errors: Record<string, string>;
  /** The to-do open in the detail sheet. */
  open: { projectId: string; todoId: string } | null;
  /** Filters shared by the list and the board: one project (null = all) and a text match. */
  scope: string | null;
  query: string;
}

export const useTodos = create<TodoState>(() => ({
  projects: null,
  items: {},
  errors: {},
  open: null,
  scope: null,
  query: "",
}));

const watched = new Set<string>();
let unsub: (() => void) | null = null;
onHostSwitch(() => {
  watched.clear();
  unsub?.();
  unsub = null;
  useTodos.setState({ projects: null, items: {}, errors: {}, open: null, scope: null });
});

/** Whether the connected host has the project to-do RPCs. */
export function supportsTodos(): boolean {
  return !!getClient()?.getLastServerInfoMessage()?.features?.projectTodos;
}

function need(): Client {
  const c = getClient();
  if (!c) throw new Error("not connected");
  return c;
}

const setError = (projectId: string, error: string | null) =>
  useTodos.setState((s) => {
    const errors = { ...s.errors };
    if (error) errors[projectId] = error;
    else delete errors[projectId];
    return { errors };
  });

function upsert(projectId: string, item: Todo): void {
  useTodos.setState((s) => {
    const list = s.items[projectId] ?? [];
    const at = list.findIndex((t) => t.id === item.id);
    const next = at < 0 ? [...list, item] : list.map((t) => (t.id === item.id ? item : t));
    return { items: { ...s.items, [projectId]: next } };
  });
}

function remove(projectId: string, todoId: string): void {
  useTodos.setState((s) => ({
    items: { ...s.items, [projectId]: (s.items[projectId] ?? []).filter((t) => t.id !== todoId) },
    open: s.open?.todoId === todoId ? null : s.open,
  }));
}

export async function loadProjects(): Promise<void> {
  const projects = await listProjects();
  useTodos.setState({ projects });
}

/** Loads a project's to-dos and keeps them live through `project.todo.changed`. */
export async function watchTodos(projectId: string, force = false): Promise<void> {
  const c = getClient();
  if (!c || (watched.has(projectId) && !force)) return;
  watched.add(projectId);
  unsub ??= c.subscribeRawMessages((m) => {
    if (m.type !== "project.todo.changed") return;
    const p = m.payload;
    if (!watched.has(p.projectId)) return;
    if (p.kind === "upsert") upsert(p.projectId, p.item);
    else remove(p.projectId, p.todoId);
  });
  try {
    const r = await c.listProjectTodos({ projectId, subscribe: true });
    if (r.error) throw new Error(r.error.message);
    useTodos.setState((s) => ({ items: { ...s.items, [projectId]: r.items } }));
    setError(projectId, null);
  } catch (e) {
    watched.delete(projectId);
    setError(projectId, e instanceof Error ? e.message : String(e));
  }
}

export async function createTodo(projectId: string, input: CreateInput): Promise<Todo> {
  const r = await need().createProjectTodo({ projectId, ...input });
  if (r.error || !r.item) throw new Error(r.error?.message ?? "could not create the to-do");
  upsert(projectId, r.item);
  return r.item;
}

export async function updateTodo(
  projectId: string,
  todoId: string,
  input: UpdateInput,
): Promise<void> {
  const r = await need().updateProjectTodo({ projectId, todoId, ...input });
  if (r.error) throw new Error(r.error.message);
  if (r.item) upsert(projectId, r.item);
}

export async function setTodoStatus(
  projectId: string,
  todoId: string,
  status: TodoStatus,
): Promise<void> {
  // Optimistic: the card moves columns at once and settles on the daemon's answer.
  const before = useTodos.getState().items[projectId]?.find((t) => t.id === todoId);
  if (before) upsert(projectId, { ...before, status });
  try {
    const r = await need().setProjectTodoStatus({ projectId, todoId, status });
    if (r.error) throw new Error(r.error.message);
    if (r.item) upsert(projectId, r.item);
  } catch (e) {
    if (before) upsert(projectId, before);
    throw e;
  }
}

export async function deleteTodo(projectId: string, todoId: string): Promise<void> {
  const r = await need().deleteProjectTodo({ projectId, todoId });
  if (r.error) throw new Error(r.error.message);
  remove(projectId, todoId);
}

export const openTodo = (projectId: string, todoId: string) =>
  useTodos.setState({ open: { projectId, todoId } });
export const closeTodo = () => useTodos.setState({ open: null });
export const setTodoScope = (scope: string | null) => useTodos.setState({ scope });
export const setTodoQuery = (query: string) => useTodos.setState({ query });

export interface ScopedTodo {
  projectId: string;
  todo: Todo;
}

/** Every loaded to-do the filters let through, tagged with its project. */
export function filterTodos(s: TodoState): ScopedTodo[] {
  const q = s.query.trim().toLowerCase();
  const ids = s.scope ? [s.scope] : Object.keys(s.items);
  return ids.flatMap((projectId) =>
    (s.items[projectId] ?? [])
      .filter(
        (t) =>
          !q ||
          `${t.title} ${t.description} ${t.category ?? ""}`.toLowerCase().includes(q) ||
          t.id.toLowerCase() === q,
      )
      .map((todo) => ({ projectId, todo })),
  );
}
