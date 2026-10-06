import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { getClient, useDaemon } from "../../daemon/store";
import { color, font } from "../../theme/tokens";
import { Button } from "../Button";
import { Select } from "../Select";
import { T } from "../Text";
import { Dialog } from "./Dialog";

type Client = NonNullable<ReturnType<typeof getClient>>;
type Todo = Awaited<ReturnType<Client["listProjectTodos"]>>["items"][number];
const statuses: Array<{ value: Todo["status"]; label: string }> = [
  { value: "backlog", label: "Backlog" },
  { value: "ready", label: "Ready" },
  { value: "claimed", label: "Claimed" },
  { value: "in_progress", label: "In progress" },
  { value: "review", label: "Review" },
  { value: "done", label: "Done" },
  { value: "blocked", label: "Blocked" },
];
const priorities: Array<{ value: Todo["priority"]; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];
export function ProjectTodos({ projectId }: { projectId: string | null }) {
  const conn = useDaemon((s) => s.conn);
  const [items, setItems] = useState<Todo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => setGeneration((v) => v + 1), []);
  useEffect(() => {
    setItems(null);
    setError(null);
    const c = getClient();
    if (!projectId || conn !== "online" || !c) return;
    if (!c.getLastServerInfoMessage()?.features?.projectTodos) {
      setError("This host does not support project to-dos.");
      return;
    }
    let active = true;
    void c.listProjectTodos({ projectId }).then(
      (r) => {
        if (!active) return;
        if (r.error) setError(r.error.message);
        else setItems(r.items);
        return undefined;
      },
      (e: unknown) => {
        if (active) setError(String(e));
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, conn, generation]);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const created = useCallback(() => {
    close();
    reload();
  }, [close, reload]);
  if (!projectId) return <T style={s.note}>Select a project session to see its to-dos.</T>;
  return (
    <ScrollView contentContainerStyle={s.body}>
      <View style={s.row}>
        <Button label="Refresh to-dos" onPress={reload} />
        <Button label="New to-do" onPress={show} disabled={!items || conn !== "online"} />
      </View>
      {conn !== "online" && <T>Connect to the host to load project to-dos.</T>}
      {error && <T style={s.error}>{error}</T>}
      {!items && !error && conn === "online" && <T>Loading to-dos…</T>}
      {items?.length === 0 && <T>No project to-dos yet.</T>}
      {statuses.map((status) => {
        const group = items?.filter((item) => item.status === status.value) ?? [];
        return group.length > 0 ? (
          <View key={status.value} style={s.stack}>
            <T v="label">
              {status.label} · {group.length}
            </T>
            {group.map((item) => (
              <TodoRow key={item.id} item={item} projectId={projectId} reload={reload} />
            ))}
          </View>
        ) : null;
      })}
      {open && <NewTodo projectId={projectId} close={close} done={created} />}
    </ScrollView>
  );
}
function NewTodo({
  projectId,
  close,
  done,
}: {
  projectId: string;
  close: () => void;
  done: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Todo["priority"]>("medium");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dismiss = useCallback(() => {
    if (!busy) close();
  }, [busy, close]);
  const create = useCallback(async () => {
    const c = getClient();
    if (!c || busy || !title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await c.createProjectTodo({
        projectId,
        title: title.trim(),
        description,
        priority,
      });
      if (r.error) throw new Error(r.error.message);
      done();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, [projectId, title, description, priority, busy, done]);
  const footer = useMemo(
    () => (
      <Button
        label={busy ? "Creating…" : "Create to-do"}
        onPress={create}
        disabled={busy || !title.trim()}
        kind="primary"
      />
    ),
    [busy, create, title],
  );
  return (
    <Dialog open onClose={dismiss} title="New project to-do" footer={footer}>
      <T v="label">Title</T>
      <TextInput
        accessibilityLabel="To-do title"
        value={title}
        onChangeText={setTitle}
        maxLength={200}
        style={s.input}
        autoFocus
      />
      <T v="label">Description</T>
      <TextInput
        accessibilityLabel="To-do description"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={20000}
        style={s.input}
      />
      <T v="label">Priority</T>
      <Select value={priority} onChange={setPriority} options={priorities} width="100%" />
      {error && <T style={s.error}>{error}</T>}
    </Dialog>
  );
}
function TodoRow({
  item,
  projectId,
  reload,
}: {
  item: Todo;
  projectId: string;
  reload: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const change = useCallback(
    async (status: Todo["status"]) => {
      const c = getClient();
      if (!c || busy) return;
      setBusy(true);
      setError(null);
      try {
        const r = await c.setProjectTodoStatus({ projectId, todoId: item.id, status });
        if (r.error) throw new Error(r.error.message);
        reload();
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [projectId, item.id, busy, reload],
  );
  return (
    <View style={s.card}>
      <T>{item.title}</T>
      {!!item.description && <T numberOfLines={3}>{item.description}</T>}
      <T v="mono">{[item.priority, item.category].filter(Boolean).join(" · ")}</T>
      {item.claims.map((claim) => (
        <T key={claim.agentId} v="mono">
          {claim.agentId}
          {claim.stale ? " · stale claim" : " · claimed"}
        </T>
      ))}
      {busy ? (
        <T>Updating…</T>
      ) : (
        <Select value={item.status} options={statuses} onChange={change} width="100%" />
      )}
      {error && <T style={s.error}>{error}</T>}
    </View>
  );
}
const s = StyleSheet.create({
  body: { padding: 14, gap: 18 },
  stack: { gap: 10 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { padding: 12, gap: 8, backgroundColor: color.panel },
  input: {
    borderWidth: 1,
    borderColor: color.line2,
    padding: 10,
    color: color.text,
    fontFamily: font.body,
  },
  error: { color: color.coral },
  note: { padding: 16, color: color.muted },
});
