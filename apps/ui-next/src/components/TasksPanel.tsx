import { RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { openTimeline, useDaemon } from "../daemon/store";
import { loadSubagents, loadTerminals, supportsSubagents, useSubWork } from "../daemon/subwork";
import { bucketOf, type Bucket } from "../daemon/types";
import { color } from "../theme/tokens";
import { useUi } from "../ui-store";
import { GroupHead, PanelHead } from "./PanelHead";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";
import { KIND_LABEL, KIND_ORDER, type SubWork } from "./subwork/model";
import { openSubWork } from "./subwork/hooks";
import { SubWorkTree } from "./subwork/views";
import { Tabs } from "./tools/Tabs";
import { ProjectTodos } from "./tools/ProjectTodos";
const TABS: Array<{ id: "session" | "todos"; label: string }> = [
  { id: "session", label: "Session" },
  { id: "todos", label: "Project to-dos" },
];

/** The open session's plan (its latest to-do list) and everything running underneath it. */
export function TasksPanel() {
  const [tab, setTab] = useState<"session" | "todos">("session");
  const selected = useUi((s) => s.selected);
  const fallback = useDaemon(
    (s) =>
      Object.values(s.sessions).sort(
        (a, b) => Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt),
      )[0]?.agent.id ?? null,
  );
  const id = selected ?? fallback;
  const session = useDaemon((s) => (id ? s.sessions[id] : undefined));
  const entries = useDaemon((s) => (id ? s.timelines[id] : undefined));
  const cwd = session?.agent.cwd;
  const { items } = useSubWork(id);
  const canSub = supportsSubagents();
  useEffect(() => {
    if (id) void openTimeline(id);
  }, [id]);
  const load = useCallback(() => {
    if (!id) return;
    void openTimeline(id);
    loadSubagents(id, true);
    if (cwd) loadTerminals(cwd, true);
  }, [id, cwd]);
  const onOpen = useCallback(
    (item: SubWork) => {
      if (id) openSubWork(id, item);
    },
    [id],
  );
  const groups = useMemo(
    () =>
      KIND_ORDER.map((kind) => ({ kind, list: items.filter((x) => x.kind === kind) })).filter(
        (g) => g.list.length > 0 || (g.kind === "subagent" && canSub),
      ),
    [items, canSub],
  );
  const plan = useMemo(() => {
    const todo = entries?.toReversed().find((e) => e.item.type === "todo");
    return todo?.item.type === "todo" ? todo.item.items : null;
  }, [entries]);
  let emptyPlan = "loading…";
  if (entries) emptyPlan = "This session has no plan yet.";
  if (!id) emptyPlan = "Select a session to see its plan.";
  const done = plan?.filter((t) => t.completed || t.status === "completed").length ?? 0;
  return (
    <View style={st.fill}>
      <PanelHead title="Tasks">
        <Pressable onPress={load} accessibilityLabel="Refresh">
          <RefreshCw size={14} color={color.faint} />
        </Pressable>
      </PanelHead>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "todos" && (
        <ProjectTodos
          key={session?.project?.projectKey ?? "none"}
          projectId={session?.project?.projectKey ?? null}
        />
      )}
      {tab === "session" && session && (
        <View style={st.sessionRow}>
          <StatusGlyph bucket={bucketOf(session.agent)} size={7} />
          <T numberOfLines={1} style={st.sessionTitle}>
            {session.agent.title || "Untitled session"}
          </T>
        </View>
      )}
      {tab === "session" && (
        <ScrollView contentContainerStyle={st.scrollPad}>
          <GroupHead label={plan ? `Plan · ${done} of ${plan.length}` : "Plan"} />
          {!plan && <T style={st.empty}>{emptyPlan}</T>}
          {plan?.map((t, i) => (
            <PlanRow key={t.id ?? `${i}:${t.text}`} t={t} />
          ))}
          {groups.map((g) => (
            <View key={g.kind}>
              <GroupHead label={KIND_LABEL[g.kind]} count={g.list.length} />
              {g.list.length === 0 && <T style={st.empty}>None spawned.</T>}
              <View style={st.group}>
                <SubWorkTree items={g.list} onOpen={onOpen} plain />
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

type PlanItem = NonNullable<
  Extract<
    NonNullable<ReturnType<typeof useDaemon.getState>["timelines"][string]>[number]["item"],
    { type: "todo" }
  >["items"]
>[number];

const STEP_BUCKET: Record<"done" | "doing" | "todo", Bucket> = {
  done: "review",
  doing: "working",
  todo: "idle",
};

function stepOf(t: PlanItem): "done" | "doing" | "todo" {
  if (t.completed || t.status === "completed") return "done";
  return t.status === "in_progress" ? "doing" : "todo";
}

function PlanRow({ t }: { t: PlanItem }) {
  const step = stepOf(t);
  return (
    <View style={st.planRow}>
      <View style={st.glyphPad}>
        <StatusGlyph bucket={STEP_BUCKET[step]} size={8} />
      </View>
      <T style={[st.planText, step === "done" && st.planDone]}>
        {step === "doing" && t.activeForm ? t.activeForm : t.text}
      </T>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  sessionTitle: { color: color.muted, fontSize: 12.5 },
  scrollPad: { paddingBottom: 16 },
  empty: { paddingHorizontal: 16, color: color.faint },
  planRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  glyphPad: { paddingTop: 5 },
  planText: { flex: 1, color: color.text },
  planDone: { color: color.muted },
  group: { marginHorizontal: 8, paddingHorizontal: 4 },
});
