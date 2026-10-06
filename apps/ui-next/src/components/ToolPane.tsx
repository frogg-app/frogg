import { View } from "react-native";
import { color } from "../theme/tokens";
import { TOOLS } from "./Rail";
import { T } from "./Text";
import type { Tool } from "../ui-store";

/** Tools not built yet show their name so the rail is navigable end to end. */
export function ToolPane({ tool }: { tool: Tool }) {
  const meta = TOOLS.find((t) => t.id === tool)!;
  const Icon = meta.icon;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <View style={{ padding: 14, borderBottomWidth: 1, borderBottomColor: color.line }}>
        <T v="display">{meta.label}</T>
      </View>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
        <Icon size={22} color={color.faint} strokeWidth={1.4} />
        <T v="label">not built yet</T>
      </View>
    </View>
  );
}
