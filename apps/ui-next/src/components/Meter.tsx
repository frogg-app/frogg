import { View } from "react-native";
import { color } from "../theme/tokens";
import { T } from "./Text";

/** A segmented bar: 20 cells, filled cells take the tone colour. */
export function Meter({ pct, label, detail, tone }: { pct: number | null; label: string; detail?: string; tone?: string }) {
  const p = pct === null ? null : Math.max(0, Math.min(100, pct));
  const tint = tone ?? (p === null ? color.faint : p >= 90 ? color.coral : p >= 70 ? color.amber : color.cyan);
  const filled = p === null ? 0 : Math.round(p / 5);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <T style={{ flex: 1, fontSize: 12.5 }}>{label}</T>
        <T v="mono" style={{ color: p === null ? color.faint : color.text, fontSize: 12 }}>{p === null ? "—" : `${Math.round(p)}%`}</T>
      </View>
      <View style={{ flexDirection: "row", gap: 2, height: 6 }}>
        {Array.from({ length: 20 }, (_, i) => (
          <View key={i} style={{ flex: 1, backgroundColor: i < filled ? tint : "rgba(255,255,255,0.07)", opacity: i < filled ? 0.55 + (0.45 * i) / 20 : 1 }} />
        ))}
      </View>
      {detail && <T v="mono" style={{ fontSize: 10.5, color: color.faint }}>{detail}</T>}
    </View>
  );
}
