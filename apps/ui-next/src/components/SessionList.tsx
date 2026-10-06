import { ChevronDown, Filter, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { answerPermission, useDaemon } from "../daemon/store";
import { bucketOf, type Bucket, type Session } from "../daemon/types";
import { color, font, web } from "../theme/tokens";
import { useUi } from "../ui-store";
import { ago } from "../util";
import { Cut } from "./Cut";
import { bucketColor, StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";

const ORDER: Array<{ b: Bucket; label: string }> = [
  { b: "needs", label: "Needs you" },
  { b: "failed", label: "Failed" },
  { b: "review", label: "Ready to review" },
  { b: "working", label: "Working" },
  { b: "idle", label: "Idle" },
];

export function useBuckets() {
  const sessions = useDaemon((s) => s.sessions);
  return useMemo(() => {
    const out: Record<Bucket, Session[]> = { needs: [], failed: [], review: [], working: [], idle: [] };
    for (const s of Object.values(sessions)) out[bucketOf(s.agent)].push(s);
    for (const list of Object.values(out))
      list.sort((a, b) => Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt));
    return out;
  }, [sessions]);
}

export function SessionList() {
  const buckets = useBuckets();
  const [q, setQ] = useState("");
  const total = ORDER.reduce((n, o) => n + buckets[o.b].length, 0) || 1;
  const match = (s: Session) =>
    !q || `${s.agent.title ?? ""} ${s.project?.projectName ?? ""}`.toLowerCase().includes(q.toLowerCase());
  return (
    <View style={s.root}>
      <View style={s.head}>
        <Pressable style={s.scope}>
          <T v="display" style={{ fontSize: 15 }}>All projects</T>
          <ChevronDown size={14} color={color.faint} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Filter size={15} color={color.faint} />
        <Pressable onPress={() => useUi.getState().setNewSession(true)} accessibilityLabel="New session" style={{ marginLeft: 14 }}>
          <Plus size={17} color={color.faint} />
        </Pressable>
      </View>
      <View style={s.meter}>
        {ORDER.map((o) =>
          buckets[o.b].length ? (
            <View key={o.b} style={{ flex: buckets[o.b].length / total, height: 3, backgroundColor: bucketColor[o.b] }} />
          ) : null,
        )}
      </View>
      <View style={s.counts}>
        {ORDER.map((o) => (
          <View key={o.b} style={s.count}>
            <StatusGlyph bucket={o.b} size={7} />
            <T style={s.countN}>{buckets[o.b].length}</T>
            <T style={s.countL}>{o.label.toLowerCase()}</T>
          </View>
        ))}
      </View>
      <Cut size={5} style={s.filter}>
        <TextInput value={q} onChangeText={setQ} placeholder="Filter sessions" placeholderTextColor={color.faint} style={s.filterIn} />
        <T v="mono" style={s.kbd}>/</T>
      </Cut>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
        {ORDER.map((o) => {
          const list = buckets[o.b].filter(match);
          if (!list.length) return null;
          return (
            <View key={o.b}>
              <View style={s.groupHead}>
                <T v="label">{o.label}</T>
                <T v="mono" style={{ color: color.faint, fontSize: 10.5 }}>{list.length}</T>
              </View>
              {list.map((sess) => <Row key={sess.agent.id} sess={sess} bucket={o.b} />)}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Row({ sess, bucket }: { sess: Session; bucket: Bucket }) {
  const selected = useUi((s) => s.selected === sess.agent.id);
  const select = useUi((s) => s.select);
  const a = sess.agent;
  const perm = a.pendingPermissions[0];
  const branch = sess.project?.checkout.isGit ? sess.project.checkout.currentBranch : null;
  return (
    <Pressable onPress={() => select(a.id)}>
      {({ hovered }) => (
        <View style={[s.row, hovered && { backgroundColor: color.wash }, selected && s.rowOn]}>
          {selected && <Brackets />}
          <View style={s.rowTop}>
            <View style={{ width: 14, paddingTop: 5 }}><StatusGlyph bucket={bucket} /></View>
            <T numberOfLines={1} style={s.title}>{a.title || "Untitled session"}</T>
            <T v="mono" style={{ fontSize: 10.5, color: color.faint }}>{ago(a.updatedAt)}</T>
          </View>
          <View style={s.meta}>
            <T style={s.proj} numberOfLines={1}>{sess.project?.projectName ?? a.cwd.split("/").pop()}</T>
            {branch && <T v="mono" numberOfLines={1} style={s.branch}>{branch}</T>}
          </View>
          {bucket === "failed" && a.lastError && (
            <T v="mono" numberOfLines={2} style={{ color: color.coral, marginTop: 6, marginLeft: 14 }}>{a.lastError}</T>
          )}
          {perm && (
            <View style={s.permRow}>
              <View style={s.permCmd}>
                <T v="mono" numberOfLines={1} style={{ color: perm.kind === "plan" ? color.amber : color.text }}>
                  {perm.kind === "plan" ? "Plan ready" : perm.title ?? perm.name}
                </T>
              </View>
              <Pressable onPress={() => (perm.kind === "plan" ? select(a.id) : void answerPermission(a.id, perm.id, true))}>
                <Cut size={6} style={s.approve}>
                  <T style={{ fontWeight: "600", color: color.onAccent, fontSize: 12.5 }}>{perm.kind === "plan" ? "Review" : "Approve"}</T>
                  <T v="mono" style={s.approveK}>A</T>
                </Cut>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

/** Corner brackets framing the selected row, the signature of this design. */
export function Brackets({ c = color.cyan2, len = 8 }: { c?: string; len?: number }) {
  const b = { position: "absolute" as const, width: len, height: len, borderColor: c };
  return (
    <>
      <View style={[b, { left: 0, top: 0, borderLeftWidth: 1, borderTopWidth: 1 }]} />
      <View style={[b, { right: 0, top: 0, borderRightWidth: 1, borderTopWidth: 1 }]} />
      <View style={[b, { left: 0, bottom: 0, borderLeftWidth: 1, borderBottomWidth: 1 }]} />
      <View style={[b, { right: 0, bottom: 0, borderRightWidth: 1, borderBottomWidth: 1 }]} />
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10 },
  scope: { flexDirection: "row", alignItems: "center", gap: 6 },
  meter: { flexDirection: "row", gap: 2, marginHorizontal: 14, backgroundColor: color.line },
  counts: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4, paddingHorizontal: 14, paddingVertical: 8 },
  count: { flexDirection: "row", alignItems: "center", gap: 5 },
  countN: { fontSize: 11.5, fontWeight: "600" },
  countL: { fontSize: 11.5, color: color.muted },
  filter: {
    flexDirection: "row", alignItems: "center", marginHorizontal: 12, marginBottom: 6,
    backgroundColor: color.panel, borderWidth: 1, borderColor: color.line,
  },
  filterIn: {
    flex: 1, paddingHorizontal: 10, paddingVertical: 7, color: color.text, fontFamily: font.body, fontSize: 13,
    ...web({ outlineStyle: "none" }),
  },
  kbd: { borderWidth: 1, borderColor: color.line2, paddingHorizontal: 5, marginRight: 8, fontSize: 10 },
  groupHead: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  row: { marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: color.line },
  rowOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  title: { flex: 1, fontSize: 13.5, fontWeight: "500" },
  meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, marginLeft: 18 },
  proj: { fontSize: 12, color: color.muted },
  branch: { fontSize: 11, color: color.faint, flexShrink: 1 },
  permRow: { flexDirection: "row", gap: 8, marginTop: 8, marginLeft: 18 },
  permCmd: { flex: 1, backgroundColor: "rgba(245,184,74,0.07)", paddingHorizontal: 8, justifyContent: "center" },
  approve: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: color.cyan2,
    ...web({ backgroundImage: "linear-gradient(135deg, #7fd9e6, #25b5c8)" }),
  },
  approveK: { fontSize: 9.5, color: color.onAccent, borderWidth: 1, borderColor: "rgba(4,22,26,0.35)", paddingHorizontal: 3 },
});
