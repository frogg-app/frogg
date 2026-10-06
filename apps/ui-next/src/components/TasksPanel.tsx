import { RefreshCw } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { getClient, openTimeline, useDaemon } from "../daemon/store";
import { bucketOf } from "../daemon/types";
import { color } from "../theme/tokens";
import { useUi } from "../ui-store";
import { ago } from "../util";
import { GroupHead, PanelHead } from "./PanelHead";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";

type Subagent = Awaited<ReturnType<NonNullable<ReturnType<typeof getClient>>["listProviderSubagents"]>>["subagents"][number];

/** The open session's plan (its latest to-do list) and the subagents it has spawned. */
export function TasksPanel() {
  const selected = useUi((s) => s.selected);
  const fallback = useDaemon((s) =>
    Object.values(s.sessions).sort((a, b) => Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt))[0]?.agent.id ?? null,
  );
  const id = selected ?? fallback;
  const session = useDaemon((s) => (id ? s.sessions[id] : undefined));
  const entries = useDaemon((s) => (id ? s.timelines[id] : undefined));
  const [subs, setSubs] = useState<Subagent[] | null>(null);
  const load = () => {
    if (!id) return;
    void openTimeline(id);
    void getClient()?.listProviderSubagents(id).then((r) => setSubs(r.subagents), () => setSubs([]));
  };
  useEffect(load, [id]);
  const plan = useMemo(() => {
    const todo = entries ? [...entries].reverse().find((e) => e.item.type === "todo") : undefined;
    return todo?.item.type === "todo" ? todo.item.items : null;
  }, [entries]);
  const done = plan?.filter((t) => t.completed || t.status === "completed").length ?? 0;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Tasks">
        <Pressable onPress={load} accessibilityLabel="Refresh"><RefreshCw size={14} color={color.faint} /></Pressable>
      </PanelHead>
      {session && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 4 }}>
          <StatusGlyph bucket={bucketOf(session.agent)} size={7} />
          <T numberOfLines={1} style={{ color: color.muted, fontSize: 12.5 }}>{session.agent.title || "Untitled session"}</T>
        </View>
      )}
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <GroupHead label={plan ? `Plan · ${done} of ${plan.length}` : "Plan"} />
        {!plan && <T style={{ paddingHorizontal: 16, color: color.faint }}>{entries ? "This session has no plan yet." : "loading…"}</T>}
        {plan?.map((t, i) => {
          const st = t.completed || t.status === "completed" ? "done" : t.status === "in_progress" ? "doing" : "todo";
          return (
            <View key={t.id ?? i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.line }}>
              <View style={{ paddingTop: 5 }}>
                <StatusGlyph bucket={st === "done" ? "review" : st === "doing" ? "working" : "idle"} size={8} />
              </View>
              <T style={{ flex: 1, color: st === "done" ? color.muted : color.text }}>
                {st === "doing" && t.activeForm ? t.activeForm : t.text}
              </T>
            </View>
          );
        })}
        <GroupHead label="Subagents" count={subs?.length} />
        {subs?.length === 0 && <T style={{ paddingHorizontal: 16, color: color.faint }}>None spawned.</T>}
        {subs?.map((a) => (
          <View key={a.id} style={{ marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: color.line, marginLeft: a.parentSubagentId ? 24 : 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <StatusGlyph bucket={a.status === "running" ? "working" : a.status === "failed" ? "failed" : a.status === "completed" ? "review" : "idle"} size={8} />
              <T numberOfLines={1} style={{ flex: 1 }}>{a.title ?? a.description ?? "Subagent"}</T>
              <T v="mono" style={{ fontSize: 10.5 }}>{ago(a.updatedAt)}</T>
            </View>
            {a.subtitle && <T v="mono" numberOfLines={1} style={{ marginLeft: 17, marginTop: 3, fontSize: 11 }}>{a.subtitle}</T>}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
