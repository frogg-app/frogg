import { Bell, FolderGit2, Layers, MoreHorizontal, Search, Settings, type LucideIcon } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, font } from "../theme/tokens";
import { useUi, type Tool } from "../ui-store";
import { Cut } from "./Cut";
import { T } from "./Text";

const TABS: Array<{ id: Tool | "more"; icon: LucideIcon; label: string }> = [
  { id: "sessions", icon: Layers, label: "Sessions" },
  { id: "search", icon: Search, label: "Search" },
  { id: "scm", icon: FolderGit2, label: "Source" },
  { id: "inbox", icon: Bell, label: "Inbox" },
  { id: "settings", icon: Settings, label: "Settings" },
  { id: "more", icon: MoreHorizontal, label: "More" },
];

export function PhoneTabs({ badges }: { badges: Partial<Record<Tool, number>> }) {
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {TABS.map(({ id, icon: Icon, label }) => {
        const on = tool === id;
        const badge = id !== "more" ? badges[id] : undefined;
        return (
          <Pressable key={id} style={{ flex: 1 }} onPress={() => id !== "more" && setTool(id)}>
            <Cut size={8} style={[s.tab, on && s.on]}>
              <Icon size={18} strokeWidth={1.6} color={on ? color.cyan2 : color.faint} />
              <T style={[s.l, on && { color: color.cyan2 }]}>{label}</T>
              {!!badge && <View style={s.badge}><T style={s.bt}>{badge}</T></View>}
            </Cut>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", gap: 2, paddingHorizontal: 4, paddingTop: 6, backgroundColor: color.bg, borderTopWidth: 1, borderTopColor: color.line },
  tab: { alignItems: "center", gap: 4, paddingVertical: 6 },
  on: { backgroundColor: "rgba(127,217,230,0.1)" },
  l: { fontSize: 10.5, color: color.faint },
  badge: { position: "absolute", top: 2, right: "22%", minWidth: 14, height: 14, paddingHorizontal: 3, backgroundColor: color.amber },
  bt: { fontFamily: font.mono, fontSize: 9, lineHeight: 14, fontWeight: "600", color: "#1a1204", textAlign: "center" },
});
