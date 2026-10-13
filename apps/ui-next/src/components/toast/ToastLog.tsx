import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { color } from "../../theme/tokens";
import { ago } from "../../util";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import { clearToastHistory, useToastHistory, type ToastRecord } from "./history";
import type { ToastKind } from "./store";

const PAGE = 20;

const glyph = { done: "review", error: "failed", needs: "needs", info: "working" } as const;

function Mark({ kind }: { kind: ToastKind }) {
  if (kind === "ok") return <View style={s.ok} />;
  return <StatusGlyph bucket={glyph[kind]} size={7} still />;
}

/** Inbox section: every toast raised on this device, newest first, kept per the retention setting. */
export function ToastLog() {
  const records = useToastHistory((st) => st.records);
  const [shown, setShown] = useState(PAGE);
  const more = useCallback(() => setShown((n) => n + PAGE), []);
  if (records.length === 0) return null;
  return (
    <View>
      <View style={s.head}>
        <T v="label" style={s.flex}>
          Toasts
        </T>
        <T v="mono" style={s.count}>
          {records.length}
        </T>
        <Pressable onPress={clearToastHistory} hitSlop={6} accessibilityLabel="Clear toast history">
          {({ hovered }) => <T style={[s.clear, hovered && s.clearH]}>Clear</T>}
        </Pressable>
      </View>
      {records.slice(0, shown).map((r) => (
        <Row key={r.id} r={r} />
      ))}
      {records.length > shown && (
        <Pressable onPress={more} style={s.more}>
          {({ hovered }) => (
            <T style={[s.clear, hovered && s.clearH]}>
              Show {Math.min(PAGE, records.length - shown)} more
            </T>
          )}
        </Pressable>
      )}
    </View>
  );
}

function Row({ r }: { r: ToastRecord }) {
  return (
    <View style={s.row} testID="toast-log-row">
      <View style={s.line}>
        <Mark kind={r.kind} />
        <T numberOfLines={1} style={s.title}>
          {r.title}
        </T>
        <T v="mono" style={s.when}>
          {ago(new Date(r.at).toISOString())}
        </T>
      </View>
      {r.detail && (
        <T v="mono" numberOfLines={2} style={s.detail}>
          {r.detail}
        </T>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  count: { fontSize: 10.5, color: color.faint },
  clear: { fontSize: 11.5, color: color.faint },
  clearH: { color: color.text },
  row: {
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  ok: { width: 7, height: 7, backgroundColor: color.mint },
  title: { flex: 1, fontSize: 12.5, color: color.muted },
  when: { fontSize: 10.5, color: color.faint },
  detail: { marginTop: 3, marginLeft: 15, fontSize: 11, color: color.faint },
  more: { paddingHorizontal: 16, paddingVertical: 10 },
});
