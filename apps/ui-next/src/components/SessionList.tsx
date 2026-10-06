import { ChevronDown, Filter, Plus } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View, type ViewStyle } from "react-native";
import { answerPermission, useDaemon } from "../daemon/store";
import { bucketOf, type Bucket, type Session } from "../daemon/types";
import { color, font, motion, web } from "../theme/tokens";
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
    const out: Record<Bucket, Session[]> = {
      needs: [],
      failed: [],
      review: [],
      working: [],
      idle: [],
    };
    for (const s of Object.values(sessions)) out[bucketOf(s.agent)].push(s);
    for (const list of Object.values(out))
      list.sort((a, b) => Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt));
    return out;
  }, [sessions]);
}

const openNewSession = () => useUi.getState().setNewSession(true);

export function SessionList() {
  const buckets = useBuckets();
  const [q, setQ] = useState("");
  const total = ORDER.reduce((n, o) => n + buckets[o.b].length, 0) || 1;
  // The proportional meter: one segment per non-empty bucket, sized by its share.
  const segments = useMemo(
    () =>
      ORDER.filter((o) => buckets[o.b].length).map((o) => ({
        b: o.b,
        style: [
          s.segment,
          {
            flex: buckets[o.b].length / total,
            backgroundColor: bucketColor[o.b],
          },
        ],
      })),
    [buckets, total],
  );
  const needle = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      ORDER.map((o) => ({
        ...o,
        list: needle
          ? buckets[o.b].filter((x) =>
              `${x.agent.title ?? ""} ${x.project?.projectName ?? ""}`
                .toLowerCase()
                .includes(needle),
            )
          : buckets[o.b],
      })).filter((g) => g.list.length),
    [buckets, needle],
  );
  return (
    <View style={s.root}>
      <View style={s.head}>
        <Pressable style={s.scope}>
          <T v="display" style={s.scopeT}>
            All projects
          </T>
          <ChevronDown size={14} color={color.faint} />
        </Pressable>
        <View style={s.spacer} />
        <Filter size={15} color={color.faint} />
        <Pressable onPress={openNewSession} accessibilityLabel="New session" style={s.plus}>
          <Plus size={17} color={color.faint} />
        </Pressable>
      </View>
      <View style={s.meter}>
        {segments.map((seg) => (
          <View key={seg.b} style={seg.style} />
        ))}
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
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Filter sessions"
          placeholderTextColor={color.faint}
          style={s.filterIn}
        />
        <T v="mono" style={s.kbd}>
          /
        </T>
      </Cut>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody}>
        {groups.map((g) => (
          <View key={g.b}>
            <View style={s.groupHead}>
              <T v="label">{g.label}</T>
              <T v="mono" style={s.groupN}>
                {g.list.length}
              </T>
            </View>
            {g.list.map((sess) => (
              <Row key={sess.agent.id} sess={sess} bucket={g.b} />
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Row({ sess, bucket }: { sess: Session; bucket: Bucket }) {
  const a = sess.agent;
  const selected = useUi((st) => st.selected === a.id);
  const perm = a.pendingPermissions[0];
  const plan = perm?.kind === "plan";
  const branch = sess.project?.checkout.isGit ? sess.project.checkout.currentBranch : null;
  const open = useCallback(() => useUi.getState().select(a.id), [a.id]);
  // A plan needs reading, so its button opens the session; anything else approves in place.
  const act = useCallback(() => {
    if (!perm || perm.kind === "plan") useUi.getState().select(a.id);
    else void answerPermission(a.id, perm.id, true);
  }, [a.id, perm]);
  return (
    <Pressable onPress={open}>
      {({ hovered }) => (
        <View style={[s.row, hovered && s.rowHover, selected && s.rowOn]}>
          {selected && <Brackets />}
          <View style={s.rowTop}>
            <View style={s.glyph}>
              <StatusGlyph bucket={bucket} />
            </View>
            <T numberOfLines={1} style={s.title}>
              {a.title || "Untitled session"}
            </T>
            <T v="mono" style={s.time}>
              {ago(a.updatedAt)}
            </T>
          </View>
          <View style={s.meta}>
            <T style={s.proj} numberOfLines={1}>
              {sess.project?.projectName ?? a.cwd.split("/").pop()}
            </T>
            {branch && (
              <T v="mono" numberOfLines={1} style={s.branch}>
                {branch}
              </T>
            )}
          </View>
          {bucket === "failed" && a.lastError && (
            <T v="mono" numberOfLines={2} style={s.error}>
              {a.lastError}
            </T>
          )}
          {perm && (
            <View style={s.permRow}>
              <View style={s.permCmd}>
                <T v="mono" numberOfLines={1} style={plan ? s.permPlan : s.permText}>
                  {plan ? "Plan ready" : (perm.title ?? perm.name)}
                </T>
              </View>
              <Pressable onPress={act}>
                <Cut size={6} style={s.approve}>
                  <T style={s.approveT}>{plan ? "Review" : "Approve"}</T>
                  <T v="mono" style={s.approveK}>
                    A
                  </T>
                </Cut>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

// Brackets render in a handful of colours and sizes; build each corner set once.
const bracketCache = new Map<string, ViewStyle[]>();
function bracketCorners(c: string, len: number): ViewStyle[] {
  const key = `${c}:${len}`;
  let corners = bracketCache.get(key);
  if (!corners) {
    const b = {
      position: "absolute" as const,
      width: len,
      height: len,
      borderColor: c,
    };
    const st = StyleSheet.create({
      tl: { ...b, left: 0, top: 0, borderLeftWidth: 1, borderTopWidth: 1 },
      tr: { ...b, right: 0, top: 0, borderRightWidth: 1, borderTopWidth: 1 },
      bl: {
        ...b,
        left: 0,
        bottom: 0,
        borderLeftWidth: 1,
        borderBottomWidth: 1,
      },
      br: {
        ...b,
        right: 0,
        bottom: 0,
        borderRightWidth: 1,
        borderBottomWidth: 1,
      },
    });
    corners = [st.tl, st.tr, st.bl, st.br];
    bracketCache.set(key, corners);
  }
  return corners;
}

const CORNERS = ["tl", "tr", "bl", "br"];

/** Corner brackets framing the selected item, the signature of this design. */
export function Brackets({ c = color.cyan2, len = 8 }: { c?: string; len?: number }) {
  const corners = bracketCorners(c, len);
  return (
    <View pointerEvents="none" style={s.brackets}>
      {corners.map((st, n) => (
        <View key={CORNERS[n]} style={st} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  scope: { flexDirection: "row", alignItems: "center", gap: 6 },
  scopeT: { fontSize: 15 },
  spacer: { flex: 1 },
  plus: { marginLeft: 14 },
  meter: {
    flexDirection: "row",
    gap: 2,
    marginHorizontal: 14,
    backgroundColor: color.line,
  },
  segment: { height: 3 },
  counts: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  count: { flexDirection: "row", alignItems: "center", gap: 5 },
  countN: { fontSize: 11.5, fontWeight: "600" },
  countL: { fontSize: 11.5, color: color.muted },
  filter: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
  },
  filterIn: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    ...web({ outlineStyle: "none" }),
  },
  kbd: {
    borderWidth: 1,
    borderColor: color.line2,
    paddingHorizontal: 5,
    marginRight: 8,
    fontSize: 10,
  },
  scroll: { flex: 1 },
  scrollBody: { paddingBottom: 16 },
  groupHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  groupN: { color: color.faint, fontSize: 10.5 },
  row: {
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowHover: { backgroundColor: color.wash },
  rowOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  glyph: { width: 14, paddingTop: 5 },
  title: { flex: 1, fontSize: 13.5, fontWeight: "500" },
  time: { fontSize: 10.5, color: color.faint },
  meta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    marginLeft: 18,
  },
  proj: { fontSize: 12, color: color.muted },
  branch: { fontSize: 11, color: color.faint, flexShrink: 1 },
  error: { color: color.coral, marginTop: 6, marginLeft: 14 },
  permRow: { flexDirection: "row", gap: 8, marginTop: 8, marginLeft: 18 },
  permCmd: {
    flex: 1,
    backgroundColor: "rgba(245,184,74,0.07)",
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  permText: { color: color.text },
  permPlan: { color: color.amber },
  approve: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: color.cyan2,
    ...web({ backgroundImage: "linear-gradient(135deg, #7fd9e6, #25b5c8)" }),
  },
  approveT: { fontWeight: "600", color: color.onAccent, fontSize: 12.5 },
  approveK: {
    fontSize: 9.5,
    color: color.onAccent,
    borderWidth: 1,
    borderColor: "rgba(4,22,26,0.35)",
    paddingHorizontal: 3,
  },
  brackets: { ...StyleSheet.absoluteFillObject, ...motion.snap },
});
