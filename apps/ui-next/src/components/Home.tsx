import { Plus, QrCode, Upload, Zap, type LucideIcon } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { useFormFactor } from "../theme/layout";
import { useUi } from "../ui-store";
import { Composer } from "./Composer";
import { Cut } from "./Cut";
import { T } from "./Text";

const CARDS: Array<{ icon: LucideIcon; title: string; sub: string }> = [
  { icon: Plus, title: "Add a project", sub: "Browse this host or open a path" },
  { icon: Upload, title: "Import conversations", sub: "Claude Code, Codex or JSONL files" },
  { icon: Zap, title: "Set up providers", sub: "Sign in once, use everywhere" },
  { icon: QrCode, title: "Pair a device", sub: "Phone, browser or another computer" },
];

export function Home() {
  const host = useDaemon((s) => s.serverName);
  const ff = useFormFactor();
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <View style={s.head}>
        <T v="label">{host ?? "host"}</T>
        <T v="display" style={{ fontSize: 22, marginTop: 4 }}>Start something</T>
      </View>
      <ScrollView contentContainerStyle={{ padding: ff === "phone" ? 16 : 24 }}>
        <View style={s.cards}>
          {CARDS.map(({ icon: Icon, title, sub }) => (
            <Pressable key={title} style={{ flexGrow: 1, flexBasis: ff === "phone" ? "45%" : 200 }} onPress={title === "Add a project" ? () => useUi.getState().setNewSession(true) : undefined}>
              {({ hovered }) => (
                <Cut size={12} flip style={[s.card, hovered && { backgroundColor: color.raise }]}>
                  <Icon size={18} color={color.cyan2} strokeWidth={1.6} />
                  <T style={{ fontWeight: "600", marginTop: 14 }}>{title}</T>
                  <T style={{ color: color.faint, fontSize: 12.5, marginTop: 4 }}>{sub}</T>
                </Cut>
              )}
            </Pressable>
          ))}
        </View>
        <View style={s.ask}>
          <T v="label" style={{ textAlign: "center" }}>or just ask · no project</T>
          <T v="display" style={{ fontSize: ff === "phone" ? 22 : 28, textAlign: "center", marginVertical: 16 }}>
            What do you want to know?
          </T>
          <Composer placeholder="Ask anything…" chips={["Claude Code", "Opus 5.5"]} onSend={(t) => useUi.getState().setNewSession(true, t)} />
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  head: { paddingHorizontal: 24, paddingTop: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: color.line },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  card: { backgroundColor: color.panel, padding: 16, minHeight: 120 },
  ask: { maxWidth: 760, width: "100%", alignSelf: "center", marginTop: 56 },
});
