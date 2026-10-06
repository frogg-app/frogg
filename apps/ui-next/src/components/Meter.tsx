import { StyleSheet, View, type ViewStyle } from "react-native";
import { color } from "../theme/tokens";
import { T } from "./Text";

const CELLS = Array.from({ length: 20 }, (_, n) => ({ id: `c${n}`, n }));

function toneFor(p: number | null): string {
  if (p === null) return color.faint;
  if (p >= 90) return color.coral;
  if (p >= 70) return color.amber;
  return color.cyan;
}

const cellCache = new Map<string, ViewStyle>();
function cellStyle(n: number, filled: number, tint: string): ViewStyle {
  const on = n < filled;
  const key = on ? `${tint}:${n}` : "off";
  let style = cellCache.get(key);
  if (!style) {
    style = StyleSheet.create({
      c: {
        flex: 1,
        backgroundColor: on ? tint : "rgba(255,255,255,0.07)",
        opacity: on ? 0.55 + (0.45 * n) / 20 : 1,
      },
    }).c;
    cellCache.set(key, style);
  }
  return style;
}

/** A segmented bar: 20 cells, filled cells take the tone colour and brighten toward the end. */
export function Meter({
  pct,
  label,
  detail,
  tone,
}: {
  pct: number | null;
  label: string;
  detail?: string;
  tone?: string;
}) {
  const p = pct === null ? null : Math.max(0, Math.min(100, pct));
  const tint = tone ?? toneFor(p);
  const filled = p === null ? 0 : Math.round(p / 5);
  return (
    <View style={s.root}>
      <View style={s.head}>
        <T style={s.label}>{label}</T>
        <T v="mono" style={p === null ? s.pctNone : s.pct}>
          {p === null ? "—" : `${Math.round(p)}%`}
        </T>
      </View>
      <View style={s.bar}>
        {CELLS.map((c) => (
          <View key={c.id} style={cellStyle(c.n, filled, tint)} />
        ))}
      </View>
      {detail && (
        <T v="mono" style={s.detail}>
          {detail}
        </T>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 6 },
  head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  label: { flex: 1, fontSize: 12.5 },
  pct: { color: color.text, fontSize: 12 },
  pctNone: { color: color.faint, fontSize: 12 },
  bar: { flexDirection: "row", gap: 2, height: 6 },
  detail: { fontSize: 10.5, color: color.faint },
});
