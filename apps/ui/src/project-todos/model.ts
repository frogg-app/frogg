import {
  PROJECT_TODO_PRIORITIES,
  PROJECT_TODO_STATUSES,
  type ProjectTodoPriority,
  type ProjectTodoStatus,
  type ProjectTodoSummary,
} from "@frogg/protocol/todos/schemas";

// Pure state for the project to-do surface. The list query caches a
// `ProjectTodoListState`; live `project.todo.changed` events fold into it here.

export interface ProjectTodoListState {
  items: ProjectTodoSummary[];
  categories: string[];
}

export type ProjectTodoChange =
  | { kind: "upsert"; projectId: string; item: ProjectTodoSummary }
  | { kind: "remove"; projectId: string; todoId: string };

/** "all" hides nothing; "open" hides done items (the default working view). */
export type ProjectTodoStatusFilter = "open" | "all" | ProjectTodoStatus;

export const PROJECT_TODO_STATUS_FILTERS: readonly ProjectTodoStatusFilter[] = [
  "open",
  "all",
  ...PROJECT_TODO_STATUSES,
];

function sortedCategories(items: readonly ProjectTodoSummary[], known: readonly string[]) {
  const set = new Set(known);
  for (const item of items) if (item.category) set.add(item.category);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Apply one change event. Returns the same object when the event is for another project. */
export function applyProjectTodoChange(
  state: ProjectTodoListState,
  projectId: string,
  change: ProjectTodoChange,
): ProjectTodoListState {
  if (change.projectId !== projectId) return state;
  if (change.kind === "remove") {
    if (!state.items.some((item) => item.id === change.todoId)) return state;
    return { ...state, items: state.items.filter((item) => item.id !== change.todoId) };
  }
  const index = state.items.findIndex((item) => item.id === change.item.id);
  const items =
    index === -1
      ? [...state.items, change.item]
      : state.items.map((item, i) => (i === index ? change.item : item));
  return { items, categories: sortedCategories(items, state.categories) };
}

export function matchesStatusFilter(
  status: ProjectTodoStatus,
  filter: ProjectTodoStatusFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "open") return status !== "done";
  return status === filter;
}

const PRIORITY_RANK = new Map<ProjectTodoPriority, number>(
  PROJECT_TODO_PRIORITIES.map((priority, index) => [priority, index]),
);
const STATUS_RANK = new Map<ProjectTodoStatus, number>(
  PROJECT_TODO_STATUSES.map((status, index) => [status, index]),
);

/** Highest priority first, then board order, then most recently updated. */
export function compareProjectTodos(a: ProjectTodoSummary, b: ProjectTodoSummary): number {
  const priority = (PRIORITY_RANK.get(b.priority) ?? 0) - (PRIORITY_RANK.get(a.priority) ?? 0);
  if (priority !== 0) return priority;
  const status = (STATUS_RANK.get(a.status) ?? 0) - (STATUS_RANK.get(b.status) ?? 0);
  if (status !== 0) return status;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export interface ProjectTodoGroup {
  /** `null` is the uncategorised group, always listed last. */
  category: string | null;
  items: ProjectTodoSummary[];
}

export function groupProjectTodos(
  items: readonly ProjectTodoSummary[],
  filter: ProjectTodoStatusFilter,
): ProjectTodoGroup[] {
  const byCategory = new Map<string | null, ProjectTodoSummary[]>();
  for (const item of items) {
    if (!matchesStatusFilter(item.status, filter)) continue;
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push(item);
    byCategory.set(item.category, bucket);
  }
  return [...byCategory.entries()]
    .sort(([a], [b]) => {
      if (a === null) return b === null ? 0 : 1;
      if (b === null) return -1;
      return a.localeCompare(b);
    })
    .map(([category, bucket]) => ({ category, items: bucket.sort(compareProjectTodos) }));
}

export interface ProjectTodoFormValues {
  title: string;
  description: string;
  category: string;
  priority: ProjectTodoPriority;
  allowParallel: boolean;
}

export const EMPTY_PROJECT_TODO_FORM: ProjectTodoFormValues = {
  title: "",
  description: "",
  category: "",
  priority: "medium",
  allowParallel: false,
};

export function formValuesFromTodo(item: ProjectTodoSummary): ProjectTodoFormValues {
  return {
    title: item.title,
    description: item.description,
    category: item.category ?? "",
    priority: item.priority,
    allowParallel: item.allowParallel,
  };
}

/** Trimmed request fields; an empty category clears it. `null` when the title is blank. */
export function normalizeProjectTodoForm(values: ProjectTodoFormValues) {
  const title = values.title.trim();
  if (!title) return null;
  const category = values.category.trim();
  return {
    title,
    description: values.description.trim(),
    category: category.length > 0 ? category : null,
    priority: values.priority,
    allowParallel: values.allowParallel,
  };
}
