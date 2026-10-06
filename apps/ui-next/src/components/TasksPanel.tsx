import { RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { getClient, openTimeline, useDaemon } from "../daemon/store";
import { bucketOf, type Bucket } from "../daemon/types";
import { color } from "../theme/tokens";
import { useUi } from "../ui-store";
import { ago } from "../util";
import { GroupHead, PanelHead } from "./PanelHead";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";
import { Tabs } from "./tools/Tabs";
import { ProjectTodos } from "./tools/ProjectTodos";
const TABS: Array<{ id: "session" | "todos"; label: string }> = [
  { id: "session", label: "Session" },
  { id: "todos", label: "Project to-dos" },
];

type Subagent = Awaited<
  ReturnType<NonNullable<ReturnType<typeof getClient>>["listProviderSubagents"]>
>["subagents"][number];

/** The open session's plan (its latest to-do list) and the subagents it has spawned. */
export function TasksPanel() {
  const [tab, setTab] = useState<"session" | "todos">("session");
  const [error, setError] = useState<string | null>(null);
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
  const [subs, setSubs] = useState<Subagent[] | null>(null);
  const load = useCallback(() => {
    setSubs(null);
    setError(null);
    if (!id) return;
    void openTimeline(id);
    void getClient()
      ?.listProviderSubagents(id)
      .then(
        (r) => setSubs(r.subagents),
        (e: unknown) => setError(String(e)),
      );
  }, [id]);
  useEffect(load, [load]);
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
          {error && <T style={st.empty}>{error}</T>}
          <GroupHead label={plan ? `Plan · ${done} of ${plan.length}` : "Plan"} />
          {!plan && <T style={st.empty}>{emptyPlan}</T>}
          {plan?.map((t, i) => (
            <PlanRow key={t.id ?? `${i}:${t.text}`} t={t} />
          ))}
          <GroupHead label="Subagents" count={subs?.length} />
          {subs?.length === 0 && <T style={st.empty}>None spawned.</T>}
          {subs?.map((a) => (
            <View key={a.id} style={[st.sub, !!a.parentSubagentId && st.subNested]}>
              <View style={st.subHead}>
                <StatusGlyph bucket={SUB_BUCKET[a.status] ?? "idle"} size={8} />
                <T numberOfLines={1} style={st.flex}>
                  {a.title ?? a.description ?? "Subagent"}
                </T>
                <T v="mono" style={st.time}>
                  {ago(a.updatedAt)}
                </T>
              </View>
              {a.subtitle && (
                <T v="mono" numberOfLines={1} style={st.subtitle}>
                  {a.subtitle}
                </T>
              )}
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

const SUB_BUCKET: Record<string, Bucket> = {
  running: "working",
  failed: "failed",
  completed: "review",
};
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
  flex: { flex: 1 },
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
  sub: {
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    marginLeft: 8,
  },
  subNested: { marginLeft: 24 },
  subHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  time: { fontSize: 10.5 },
  subtitle: { marginLeft: 17, marginTop: 3, fontSize: 11 },
});
