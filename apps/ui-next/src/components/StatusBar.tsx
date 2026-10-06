import { StyleSheet, View } from "react-native";
import { useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { Logo } from "./Logo";
import { useBuckets } from "./SessionList";
import { T } from "./Text";

export function StatusBar() {
  const conn = useDaemon((s) => s.conn);
  const host = useDaemon((s) => s.serverName);
  const b = useBuckets();
  const dot = conn === "online" ? color.mint : conn === "connecting" ? color.amber : color.coral;
  return (
    <View style={s.bar}>
      <View style={[s.seg, s.brand]}>
        <Logo size={12} />
        <T style={{ fontSize: 12, fontWeight: "600", color: color.cyan2 }}>frogg</T>
      </View>
      <View style={s.seg}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
        <T style={s.t}>{host ?? conn}</T>
      </View>
      <View style={{ flex: 1 }} />
      {b.needs.length > 0 && (
        <View style={[s.seg, { backgroundColor: "rgba(245,184,74,0.14)" }]}>
          <T style={[s.t, { color: color.amber }]}>◆ {b.needs.length} need you</T>
        </View>
      )}
      <View style={s.seg}><T style={s.t}>▸ {b.working.length} running</T></View>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { height: 26, flexDirection: "row", alignItems: "stretch", backgroundColor: color.bg, borderTopWidth: 1, borderTopColor: color.line },
  seg: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10 },
  brand: { backgroundColor: "rgba(37,181,200,0.12)" },
  t: { fontSize: 11.5, color: color.muted },
});
