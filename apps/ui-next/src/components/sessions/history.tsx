import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { color, font, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import { fetchHistory, restoreSession, type HistoryEntry } from "./directory";

const DAY = 86400000;

/** Calendar bucket for a past session, newest first. */
export function ageGroup(iso: string, now = Date.now()): string {
  const d = now - Date.parse(iso);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const t = Date.parse(iso);
  if (t >= today.getTime()) return "Today";
  if (t >= today.getTime() - DAY) return "Yesterday";
  if (d < 7 * DAY) return "Previous 7 days";
  if (d < 30 * DAY) return "This month";
  return "Older";
}

/** History scope: archived sessions from the daemon, searchable, restorable, paged. */
export function HistoryList() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<HistoryEntry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback((search: string, cursor?: string) => {
    setErr(null);
    fetchHistory({ search, cursor })
      .then((r) => {
        setRows((prev) => (cursor ? [...(prev ?? []), ...r.entries] : r.entries));
        setNext(r.next);
        return undefined;
      })
      .catch((e: unknown) => {
        setRows((prev) => prev ?? []);
        setErr(e instanceof Error ? e.message : String(e));
      });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q, load]);
  const more = useCallback(() => {
    if (next) load(q.trim(), next);
  }, [next, q, load]);
  const restored = useCallback(
    (id: string) => setRows((r) => (r ? r.filter((x) => x.agent.id !== id) : r)),
    [],
  );
  const groups = useMemo(() => {
    const out: Array<{ name: string; list: HistoryEntry[] }> = [];
    for (const e of rows ?? []) {
      const name = ageGroup(e.agent.archivedAt ?? e.agent.updatedAt);
      const last = out[out.length - 1];
      if (last?.name === name) last.list.push(e);
      else out.push({ name, list: [e] });
    }
    return out;
  }, [rows]);
  return (
    <View style={s.root}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search history"
        placeholderTextColor={color.faint}
        style={s.search}
      />
      <ScrollView style={s.scroll} contentContainerStyle={s.body}>
        {rows === null && <ActivityIndicator color={color.cyan} style={s.spin} />}
        {rows !== null && !rows.length && !err && (
          <T style={s.empty}>{q ? "No archived sessions match." : "No archived sessions yet."}</T>
        )}
        {err && (
          <T v="mono" style={s.err}>
            {err}
          </T>
        )}
        {groups.map((g) => (
          <View key={g.name}>
            <View style={s.groupHead}>
              <T v="label">{g.name}</T>
              <T v="mono" style={s.groupN}>
                {g.list.length}
              </T>
            </View>
            {g.list.map((e) => (
              <HistoryRow key={e.agent.id} entry={e} onRestored={restored} />
            ))}
          </View>
        ))}
        {next && (
          <Pressable onPress={more} style={s.more}>
            <T style={s.moreT}>Load more</T>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

function HistoryRow({
  entry,
  onRestored,
}: {
  entry: HistoryEntry;
  onRestored: (id: string) => void;
}) {
  const a = entry.agent;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const restore = useCallback(() => {
    setBusy(true);
    restoreSession(entry)
      .then(() => {
        onRestored(a.id);
        useUi.getState().select(a.id);
        return undefined;
      })
      .catch((e: unknown) => {
        setBusy(false);
        setErr(e instanceof Error ? e.message : String(e));
      });
  }, [entry, a.id, onRestored]);
  const project = entry.project?.projectName ?? a.cwd.split("/").pop();
  return (
    <View style={s.row}>
      <View style={s.top}>
        <View style={s.glyph}>
          <StatusGlyph bucket="review" still />
        </View>
        <T numberOfLines={1} style={s.title}>
          {a.title || "Untitled session"}
        </T>
        <T v="mono" style={s.tag}>
          archived
        </T>
      </View>
      <View style={s.top}>
        <T numberOfLines={1} style={s.meta}>
          {project}
        </T>
        <Pressable onPress={restore} disabled={busy} accessibilityLabel="Restore session">
          <T v="mono" style={s.restore}>
            {busy ? "Restoring…" : "Restore"}
          </T>
        </Pressable>
      </View>
      {err && (
        <T v="mono" style={s.err}>
          {err}
        </T>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  search: {
    marginHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.panel,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 7,
    ...web({ outlineStyle: "none" }),
  },
  scroll: { flex: 1 },
  body: { paddingBottom: 16 },
  spin: { marginTop: 24 },
  empty: { color: color.muted, fontSize: 12.5, textAlign: "center", marginTop: 32 },
  err: { color: color.coral, marginHorizontal: 16, marginTop: 8 },
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
    gap: 4,
  },
  top: { flexDirection: "row", alignItems: "center", gap: 4 },
  glyph: { width: 14 },
  title: { flex: 1, fontSize: 13.5, fontWeight: "500" },
  tag: { fontSize: 10, color: color.faint },
  meta: { flex: 1, marginLeft: 18, fontSize: 12, color: color.muted },
  restore: { fontSize: 11, color: color.muted, letterSpacing: 0.5 },
  more: { alignItems: "center", paddingVertical: 14 },
  moreT: { color: color.muted, fontSize: 13 },
});
