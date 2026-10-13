import { useEffect, useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useDaemon } from "../../daemon/store";
import {
  filterTodos,
  loadProjects,
  STATUSES,
  supportsTodos,
  useTodos,
  watchTodos,
  type ScopedTodo,
  type TodoStatus,
} from "../../daemon/todos";
import { color, motion } from "../../theme/tokens";
import { T } from "../Text";
import { STATUS_TINT, TodoCard, tintStyle } from "./TodoCard";

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 } as const;

/** Sorts a column: most urgent first, then most recently touched. */
const byUrgency = (a: ScopedTodo, b: ScopedTodo) =>
  PRIORITY_ORDER[a.todo.priority] - PRIORITY_ORDER[b.todo.priority] ||
  Date.parse(b.todo.updatedAt) - Date.parse(a.todo.updatedAt);

/** The filtered to-dos grouped by column. */
export function useColumns(): Record<TodoStatus, ScopedTodo[]> {
  const s = useTodos();
  return useMemo(() => {
    const out = Object.fromEntries(STATUSES.map((x) => [x.value, []])) as unknown as Record<
      TodoStatus,
      ScopedTodo[]
    >;
    for (const x of filterTodos(s)) out[x.todo.status].push(x);
    for (const list of Object.values(out)) list.sort(byUrgency);
    return out;
  }, [s]);
}

/** Display names by project id, for cards when the view spans projects. */
export function useProjectNames(): Record<string, string> | null {
  const projects = useTodos((s) => s.projects);
  const scope = useTodos((s) => s.scope);
  return useMemo(
    () =>
      scope
        ? null
        : Object.fromEntries((projects ?? []).map((p) => [p.projectId, p.projectDisplayName])),
    [projects, scope],
  );
}

/** Loads the host's projects and keeps the to-dos in scope live. */
export function useTodoLoader(): void {
  const conn = useDaemon((s) => s.conn);
  const scope = useTodos((s) => s.scope);
  const projects = useTodos((s) => s.projects);
  useEffect(() => {
    if (conn === "online" && supportsTodos()) void loadProjects();
  }, [conn]);
  useEffect(() => {
    if (conn !== "online" || !supportsTodos() || !projects) return;
    for (const p of projects) if (!scope || p.projectId === scope) void watchTodos(p.projectId);
  }, [conn, scope, projects]);
}

/** Kanban: one column per to-do status, the order agents move work through. */
export function TodoBoard() {
  const cols = useColumns();
  const names = useProjectNames();
  const scope = useTodos((s) => s.scope);
  const projects = useTodos((s) => s.projects);
  const total = STATUSES.reduce((n, x) => n + cols[x.value].length, 0);
  const scopeName = projects?.find((p) => p.projectId === scope)?.projectDisplayName;
  return (
    <View style={s.root}>
      <View style={s.head}>
        <T v="label">{scopeName ?? "All projects"}</T>
        <T v="display" style={s.title}>
          Board
        </T>
        <T v="mono" style={s.sub}>
          {total} to-dos · agents claim from Ready and move cards as they work
        </T>
      </View>
      <ScrollView horizontal contentContainerStyle={s.cols}>
        {STATUSES.map((x) => (
          <Column
            key={x.value}
            status={x.value}
            label={x.label}
            hint={x.hint}
            items={cols[x.value]}
            names={names}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function Column({
  status,
  label,
  hint,
  items,
  names,
}: {
  status: TodoStatus;
  label: string;
  hint: string;
  items: ScopedTodo[];
  names: Record<string, string> | null;
}) {
  const tint = tintStyle(STATUS_TINT[status]);
  return (
    <View style={s.col}>
      <View style={s.colHead}>
        <View style={[s.dot, tint.d]} />
        <T style={s.colLabel}>{label}</T>
        <T v="mono" style={s.count}>
          {items.length}
        </T>
      </View>
      <T style={s.hint}>{hint}</T>
      <ScrollView contentContainerStyle={s.cards}>
        {items.length === 0 && <View style={s.emptyCol} />}
        {items.map((x) => (
          <View key={`${x.projectId}:${x.todo.id}`} style={motion.enter}>
            <TodoCard
              projectId={x.projectId}
              todo={x.todo}
              projectName={names?.[x.projectId]}
              move
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  head: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 14,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  title: { fontSize: 20 },
  sub: { fontSize: 10.5, color: color.faint },
  cols: { padding: 16, gap: 12 },
  col: { width: 260, gap: 6 },
  colHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  dot: { width: 7, height: 7, transform: [{ rotate: "45deg" }] },
  colLabel: { flex: 1, fontSize: 13, fontWeight: "600" },
  count: { fontSize: 10.5, color: color.faint },
  hint: { fontSize: 11.5, color: color.faint, paddingHorizontal: 4, paddingBottom: 6 },
  cards: { gap: 8, paddingBottom: 24 },
  emptyCol: { height: 64, backgroundColor: color.wash },
});
