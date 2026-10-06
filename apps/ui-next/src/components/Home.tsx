import { Plus, QrCode, Upload, Zap, type LucideIcon } from "lucide-react-native";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useDaemon } from "../daemon/store";
import { useFormFactor } from "../theme/layout";
import { color } from "../theme/tokens";
import { useUi } from "../ui-store";
import { Composer } from "./Composer";
import { Cut } from "./Cut";
import { T } from "./Text";

interface Card {
  icon: LucideIcon;
  title: string;
  sub: string;
  run?: () => void;
}

const openNew = () => useUi.getState().setNewSession(true);

const CARDS: Card[] = [
  {
    icon: Plus,
    title: "Add a project",
    sub: "Browse this host or open a path",
    run: openNew,
  },
  {
    icon: Upload,
    title: "Import conversations",
    sub: "Claude Code, Codex or JSONL files",
  },
  {
    icon: Zap,
    title: "Set up providers",
    sub: "Sign in once, use everywhere",
    run: () => useUi.getState().setTool("settings"),
  },
  {
    icon: QrCode,
    title: "Pair a device",
    sub: "Phone, browser or another computer",
  },
];

const ASK_CHIPS = ["Claude Code", "Opus 5.5"];

export function Home() {
  const host = useDaemon((s) => s.serverName);
  const phone = useFormFactor() === "phone";
  const ask = useCallback((t: string) => useUi.getState().setNewSession(true, t), []);
  return (
    <View style={s.root}>
      <View style={s.head}>
        <T v="label">{host ?? "host"}</T>
        <T v="display" style={s.title}>
          Start something
        </T>
      </View>
      <ScrollView contentContainerStyle={phone ? s.bodyPhone : s.body}>
        <View style={s.cards}>
          {CARDS.map((c) => (
            <HomeCard key={c.title} card={c} phone={phone} />
          ))}
        </View>
        <View style={s.ask}>
          <T v="label" style={s.center}>
            or just ask · no project
          </T>
          <T v="display" style={phone ? s.askTitlePhone : s.askTitle}>
            What do you want to know?
          </T>
          <Composer placeholder="Ask anything…" chips={ASK_CHIPS} onSend={ask} />
        </View>
      </ScrollView>
    </View>
  );
}

function HomeCard({ card, phone }: { card: Card; phone: boolean }) {
  const { icon: Icon, title, sub, run } = card;
  return (
    <Pressable style={phone ? s.cardWrapPhone : s.cardWrap} onPress={run}>
      {({ hovered }) => (
        <Cut size={12} flip style={[s.card, hovered && s.cardHover]}>
          <Icon size={18} color={color.cyan2} strokeWidth={1.6} />
          <T style={s.cardTitle}>{title}</T>
          <T style={s.cardSub}>{sub}</T>
        </Cut>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  head: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  title: { fontSize: 22, marginTop: 4 },
  body: { padding: 24 },
  bodyPhone: { padding: 16 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  cardWrap: { flexGrow: 1, flexBasis: 200 },
  cardWrapPhone: { flexGrow: 1, flexBasis: "45%" },
  card: { backgroundColor: color.panel, padding: 16, minHeight: 120 },
  cardHover: { backgroundColor: color.raise },
  cardTitle: { fontWeight: "600", marginTop: 14 },
  cardSub: { color: color.faint, fontSize: 12.5, marginTop: 4 },
  ask: { maxWidth: 760, width: "100%", alignSelf: "center", marginTop: 56 },
  center: { textAlign: "center" },
  askTitle: { fontSize: 28, textAlign: "center", marginVertical: 16 },
  askTitlePhone: { fontSize: 22, textAlign: "center", marginVertical: 16 },
});
