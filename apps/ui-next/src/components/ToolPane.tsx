import { StyleSheet, View } from "react-native";
import { color } from "../theme/tokens";
import type { Tool } from "../ui-store";
import { TOOLS } from "./Rail";
import { T } from "./Text";

/** Fallback for a tool without a panel, so the rail stays navigable end to end. */
export function ToolPane({ tool }: { tool: Tool }) {
  const meta = TOOLS.find((t) => t.id === tool) ?? TOOLS[0];
  const Icon = meta.icon;
  return (
    <View style={s.root}>
      <View style={s.head}>
        <T v="display">{meta.label}</T>
      </View>
      <View style={s.body}>
        <Icon size={22} color={color.faint} strokeWidth={1.4} />
        <T v="label">not built yet</T>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  head: { padding: 14, borderBottomWidth: 1, borderBottomColor: color.line },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
});
