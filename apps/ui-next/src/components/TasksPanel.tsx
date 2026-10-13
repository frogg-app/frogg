import { Plus, RefreshCw, Search } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useDaemon } from "../daemon/store";
import {
  loadProjects,
  setTodoQuery,
  setTodoScope,
  STATUSES,
  supportsTodos,
  useTodos,
  watchTodos,
  type TodoStatus,
} from "../daemon/todos";
import { useFormFactor } from "../theme/layout";
import { color, motion } from "../theme/tokens";
import { BracketScope } from "./Brackets";
import { Button } from "./Button";
import { GroupHead, PanelHead } from "./PanelHead";
import { Select } from "./Select";
import { Field } from "./settings/pages/kit";
import { T } from "./Text";
import { TodoBoard, useColumns, useProjectNames, useTodoLoader } from "./tasks/TodoBoard";
import { TodoCard } from "./tasks/TodoCard";
import { NewTodoSheet, TodoDetailSheet } from "./tasks/TodoSheets";
import { Tabs } from "./tools/Tabs";

/** List order: what needs a person first, finished work last. */
const LIST_ORDER: TodoStatus[] = [
  "review",
  "blocked",
  "in_progress",
  "claimed",
  "ready",
  "backlog",
  "done",
];
const LABEL = Object.fromEntries(STATUSES.map((x) => [x.value, x.label])) as Record<
  TodoStatus,
  string
>;
const ALL = "__all";
const VIEWS: Array<{ id: "list" | "board"; label: string }> = [
  { id: "list", label: "List" },
  { id: "board", label: "Board" },
];

/**
 * Project to-dos: the shared work list agents and orchestrators claim from. The panel lists and
 * filters them; on wide layouts the main pane shows the same items as a board.
 */
export function TasksPanel() {
  useTodoLoader();
  const conn = useDaemon((s) => s.conn);
  const phone = useFormFactor() === "phone";
  const [view, setView] = useState<"list" | "board">("list");
  const [creating, setCreating] = useState(false);
  const projects = useTodos((s) => s.projects);
  const scope = useTodos((s) => s.scope);
  const query = useTodos((s) => s.query);
  const errors = useTodos((s) => s.errors);
  const loading = useTodos((s) =>
    (s.scope ? [s.scope] : (s.projects ?? []).map((p) => p.projectId)).some(
      (id) => s.items[id] === undefined || s.items[id] === null,
    ),
  );
  const supported = conn === "online" && supportsTodos();
  const scopeOptions = useMemo(
    () => [
      { value: ALL, label: "All projects" },
      ...(projects ?? []).map((p) => ({
        value: p.projectId,
        label: p.projectDisplayName,
        hint: p.projectRootPath,
      })),
    ],
    [projects],
  );
  const onScope = useCallback((v: string) => setTodoScope(v === ALL ? null : v), []);
  const refresh = useCallback(() => {
    void loadProjects();
    const s = useTodos.getState();
    for (const p of s.projects ?? [])
      if (!s.scope || p.projectId === s.scope) void watchTodos(p.projectId, true);
  }, []);
  const startNew = useCallback(() => setCreating(true), []);
  const stopNew = useCallback(() => setCreating(false), []);
  const errorList = Object.entries(errors);
  return (
    <View style={st.fill}>
      <PanelHead title="Tasks">
        <Pressable onPress={refresh} accessibilityLabel="Refresh to-dos" disabled={!supported}>
          <RefreshCw size={14} color={color.faint} />
        </Pressable>
        <Pressable onPress={startNew} accessibilityLabel="New to-do" disabled={!supported}>
          <Plus size={17} color={color.faint} />
        </Pressable>
      </PanelHead>
      {!supported && (
        <T style={st.note}>
          {conn === "online"
            ? "This host doesn't support project to-dos. Update its daemon to use Tasks."
            : "Connect to the host to load its to-dos."}
        </T>
      )}
      {supported && (
        <>
          <View style={st.filters}>
            <Select value={scope ?? ALL} options={scopeOptions} onChange={onScope} width="100%" />
            <View style={st.search}>
              <Search size={13} color={color.faint} />
              <Field
                accessibilityLabel="Filter to-dos"
                placeholder="Filter by title, description or category"
                value={query}
                onChangeText={setTodoQuery}
                grow
                style={st.searchField}
              />
            </View>
          </View>
          {phone && (
            <View style={st.views}>
              <Tabs tabs={VIEWS} value={view} onChange={setView} />
            </View>
          )}
          {errorList.map(([id, e]) => (
            <T v="mono" key={id} style={st.error}>
              {e}
            </T>
          ))}
          {phone && view === "board" ? (
            <TodoBoard />
          ) : (
            <TodoList loading={loading} onNew={startNew} />
          )}
        </>
      )}
      <TodoDetailSheet />
      {creating && <NewTodoSheet open onClose={stopNew} projectId={scope} />}
    </View>
  );
}

function TodoList({ loading, onNew }: { loading: boolean; onNew: () => void }) {
  const cols = useColumns();
  const names = useProjectNames();
  const query = useTodos((s) => s.query);
  const total = LIST_ORDER.reduce((n, k) => n + cols[k].length, 0);
  return (
    <BracketScope>
      <ScrollView contentContainerStyle={st.list}>
        {total === 0 && loading && <T style={st.note}>Loading to-dos…</T>}
        {total === 0 && !loading && (
          <View style={st.empty}>
            <T style={st.muted}>
              {query
                ? "Nothing matches the filter."
                : "No to-dos yet. Write one down and agents on this host can claim it."}
            </T>
            {!query && <Button kind="primary" label="New to-do" onPress={onNew} />}
          </View>
        )}
        {LIST_ORDER.filter((k) => cols[k].length > 0).map((k) => (
          <View key={k} style={motion.enter}>
            <GroupHead label={LABEL[k]} count={cols[k].length} />
            <View style={st.cards}>
              {cols[k].map((x) => (
                <TodoCard
                  key={`${x.projectId}:${x.todo.id}`}
                  projectId={x.projectId}
                  todo={x.todo}
                  projectName={names?.[x.projectId]}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </BracketScope>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  filters: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12, gap: 8 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 10,
    borderWidth: 1,
    borderColor: color.line,
  },
  searchField: { borderWidth: 0, paddingLeft: 0 },
  views: { paddingBottom: 4 },
  list: { paddingBottom: 20 },
  cards: { gap: 8, paddingHorizontal: 12 },
  empty: { padding: 16, gap: 12, alignItems: "flex-start" },
  muted: { color: color.muted, lineHeight: 19 },
  note: { padding: 16, color: color.muted },
  error: { color: color.coral, paddingHorizontal: 14, paddingBottom: 8, fontSize: 11 },
});
