import { Bot } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useDaemon } from "../../daemon/store";
import {
  closeTodo,
  createTodo,
  deleteTodo,
  PRIORITIES,
  setTodoStatus,
  STATUSES,
  updateTodo,
  useTodos,
  type Todo,
  type TodoPriority,
  type TodoStatus,
} from "../../daemon/todos";
import { color } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { agoText } from "../../util";
import { Button } from "../Button";
import { Select } from "../Select";
import { Field } from "../settings/pages/kit";
import { T } from "../Text";
import { toastError } from "../toast/store";
import { useConfirm } from "../tools/Confirm";
import { Dialog } from "../tools/Dialog";
import { TEMPLATES } from "./templates";

const STATUS_OPTIONS = STATUSES.map((x) => ({ value: x.value, label: x.label, hint: x.hint }));
const TEMPLATE_OPTIONS = TEMPLATES.map((t) => ({ value: t.id, label: t.label }));

/** New to-do, pre-filled from a template so the description reads as a prompt for an agent. */
export function NewTodoSheet({
  open,
  onClose,
  projectId: initialProject,
}: {
  open: boolean;
  onClose: () => void;
  /** The filtered project, or null when the list spans every project. */
  projectId: string | null;
}) {
  const projects = useTodos((s) => s.projects);
  const projectOptions = useMemo(
    () => (projects ?? []).map((p) => ({ value: p.projectId, label: p.projectDisplayName })),
    [projects],
  );
  const [projectId, setProjectId] = useState<string | null>(
    initialProject ?? projects?.[0]?.projectId ?? null,
  );
  const [template, setTemplate] = useState("blank");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [status, setStatus] = useState<TodoStatus>("ready");
  const [busy, setBusy] = useState(false);
  const pick = useCallback((id: string) => {
    const t = TEMPLATES.find((x) => x.id === id) ?? TEMPLATES[0];
    setTemplate(t.id);
    // Keep what the user already typed into the title; swap the skeleton otherwise.
    setTitle((cur) => (cur.trim() && !TEMPLATES.some((x) => x.title === cur) ? cur : t.title));
    setDescription(t.description);
    setCategory(t.category ?? "");
    setPriority(t.priority);
  }, []);
  const dismiss = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);
  const create = useCallback(async () => {
    if (!projectId || !title.trim() || busy) return;
    setBusy(true);
    try {
      await createTodo(projectId, {
        title: title.trim(),
        description,
        priority,
        status,
        category: category.trim() || null,
      });
      onClose();
    } catch (e) {
      toastError("Couldn't create the to-do", e);
    } finally {
      setBusy(false);
    }
  }, [projectId, title, description, priority, status, category, busy, onClose]);
  const onCreate = useCallback(() => void create(), [create]);
  const footer = useMemo(
    () => (
      <Button
        kind="primary"
        label={busy ? "Creating…" : "Create to-do"}
        onPress={onCreate}
        disabled={busy || !title.trim() || !projectId}
      />
    ),
    [busy, onCreate, title, projectId],
  );
  return (
    <Dialog open={open} onClose={dismiss} title="New to-do" footer={footer} width={560}>
      <View style={s.form}>
        <View style={s.pair}>
          <View style={s.half}>
            <T v="label">Template</T>
            <Select value={template} options={TEMPLATE_OPTIONS} onChange={pick} width="100%" />
          </View>
          <View style={s.half}>
            <T v="label">Project</T>
            <Select
              value={projectId}
              options={projectOptions}
              onChange={setProjectId}
              placeholder="Pick a project"
              width="100%"
            />
          </View>
        </View>
        <T v="label">Title</T>
        <Field
          accessibilityLabel="To-do title"
          value={title}
          onChangeText={setTitle}
          maxLength={200}
          autoFocus
          placeholder="What needs doing"
        />
        <T v="label">Description · what an agent reads when it picks this up</T>
        <Field
          accessibilityLabel="To-do description"
          value={description}
          onChangeText={setDescription}
          multiline
          maxLength={20000}
          style={s.area}
          placeholder="Context, where to look, and how to tell it's done"
        />
        <View style={s.pair}>
          <View style={s.half}>
            <T v="label">Priority</T>
            <Select value={priority} options={PRIORITIES} onChange={setPriority} width="100%" />
          </View>
          <View style={s.half}>
            <T v="label">Column</T>
            <Select value={status} options={STATUS_OPTIONS} onChange={setStatus} width="100%" />
          </View>
        </View>
        <T v="label">Category</T>
        <Field
          accessibilityLabel="To-do category"
          value={category}
          onChangeText={setCategory}
          maxLength={64}
          placeholder="bug, docs, perf…"
          mono
        />
      </View>
    </Dialog>
  );
}

/** The open to-do: edit it, move it, see who holds it and jump to that session. */
export function TodoDetailSheet() {
  const open = useTodos((s) => s.open);
  const todo = useTodos((s) =>
    s.open ? s.items[s.open.projectId]?.find((t) => t.id === s.open?.todoId) : undefined,
  );
  // The last item stays mounted after closing so the sheet can play its exit.
  const [last, setLast] = useState<{ projectId: string; todo: Todo } | null>(null);
  useEffect(() => {
    if (open && todo) setLast({ projectId: open.projectId, todo });
  }, [open, todo]);
  if (!last) return null;
  return (
    <TodoEditor
      key={last.todo.id}
      visible={!!open && !!todo}
      projectId={last.projectId}
      todo={last.todo}
    />
  );
}

function TodoEditor({
  visible,
  projectId,
  todo,
}: {
  visible: boolean;
  projectId: string;
  todo: Todo;
}) {
  const [title, setTitle] = useState(todo.title);
  const [description, setDescription] = useState(todo.description);
  const [category, setCategory] = useState(todo.category ?? "");
  const [priority, setPriority] = useState<TodoPriority>(todo.priority);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const dirty =
    title.trim() !== todo.title ||
    description !== todo.description ||
    (category.trim() || null) !== todo.category ||
    priority !== todo.priority;
  const save = useCallback(async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await updateTodo(projectId, todo.id, {
        title: title.trim(),
        description,
        priority,
        category: category.trim() || null,
      });
    } catch (e) {
      toastError("Couldn't save the to-do", e);
    } finally {
      setBusy(false);
    }
  }, [projectId, todo.id, title, description, priority, category, busy]);
  const onSave = useCallback(() => void save(), [save]);
  const move = useCallback(
    (status: TodoStatus) =>
      void setTodoStatus(projectId, todo.id, status).catch((e: unknown) =>
        toastError("Couldn't move the to-do", e),
      ),
    [projectId, todo.id],
  );
  const remove = useCallback(
    () =>
      confirm.ask({
        title: `Delete “${todo.title}”?`,
        body: "Agents working on it lose their claim. This can't be undone.",
        action: "Delete to-do",
        danger: true,
        run: () => {
          void deleteTodo(projectId, todo.id).catch((e: unknown) =>
            toastError("Couldn't delete the to-do", e),
          );
        },
      }),
    [confirm, projectId, todo.id, todo.title],
  );
  const footer = useMemo(
    () => (
      <View style={s.actions}>
        <Button label="Delete" kind="danger" onPress={remove} />
        <View style={s.grow} />
        <Button
          kind="primary"
          label={busy ? "Saving…" : "Save changes"}
          onPress={onSave}
          disabled={!dirty || busy || !title.trim()}
        />
      </View>
    ),
    [remove, busy, onSave, dirty, title],
  );
  return (
    <Dialog open={visible} onClose={closeTodo} title="To-do" width={600} footer={footer}>
      {confirm.dialog}
      <T v="label">Title</T>
      <Field accessibilityLabel="Title" value={title} onChangeText={setTitle} maxLength={200} />
      <T v="label">Description</T>
      <Field
        accessibilityLabel="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={20000}
        style={s.area}
      />
      <View style={s.pair}>
        <View style={s.half}>
          <T v="label">Column</T>
          <Select value={todo.status} options={STATUS_OPTIONS} onChange={move} width="100%" />
        </View>
        <View style={s.half}>
          <T v="label">Priority</T>
          <Select value={priority} options={PRIORITIES} onChange={setPriority} width="100%" />
        </View>
      </View>
      <T v="label">Category</T>
      <Field
        accessibilityLabel="Category"
        value={category}
        onChangeText={setCategory}
        maxLength={64}
        mono
      />
      <T v="label">Agents</T>
      {todo.claims.length === 0 && (
        <T style={s.muted}>
          Unclaimed. Agents on this host pick up Ready items through the to-do tools.
        </T>
      )}
      {todo.claims.map((c) => (
        <ClaimRow key={c.agentId} agentId={c.agentId} stale={c.stale} at={c.lastHeartbeat} />
      ))}
      {todo.lastProgress && (
        <>
          <T v="label">Latest progress · {todo.progressCount}</T>
          <T style={s.muted}>
            {todo.lastProgress.note}
            <T v="mono" style={s.faint}>
              {"  "}
              {agoText(todo.lastProgress.at)}
            </T>
          </T>
        </>
      )}
    </Dialog>
  );
}

function ClaimRow({ agentId, stale, at }: { agentId: string; stale: boolean; at: string }) {
  const title = useDaemon((s) => s.sessions[agentId]?.agent.title);
  const known = useDaemon((s) => !!s.sessions[agentId]);
  const go = useCallback(() => {
    closeTodo();
    const ui = useUi.getState();
    ui.setTool("sessions");
    ui.select(agentId);
  }, [agentId]);
  return (
    <View style={s.claim}>
      <Bot size={13} color={stale ? color.faint : color.violet} />
      <View style={s.grow}>
        <T numberOfLines={1}>{title || agentId}</T>
        <T v="mono" style={s.faint}>
          {stale ? "agent stopped · claim is stale" : `heartbeat ${agoText(at)}`}
        </T>
      </View>
      {known && (
        <Pressable onPress={go} accessibilityRole="link">
          <T v="mono" style={s.link}>
            Open session
          </T>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  form: { gap: 8 },
  pair: { flexDirection: "row", gap: 12 },
  half: { flex: 1, gap: 8 },
  area: { minHeight: 150, textAlignVertical: "top" },
  muted: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  faint: { color: color.faint, fontSize: 10.5 },
  claim: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    backgroundColor: color.wash,
  },
  grow: { flex: 1 },
  link: { color: color.cyan, fontSize: 11 },
  actions: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
});
