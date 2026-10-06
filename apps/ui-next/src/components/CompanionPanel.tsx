import { Bot } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { getClient, useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { Composer } from "./Composer";
import { Cut } from "./Cut";
import { GroupHead, PanelHead } from "./PanelHead";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";

type Notebook = Awaited<ReturnType<NonNullable<ReturnType<typeof getClient>>["fetchCompanionNotebook"]>>;
interface Line {
  who: "you" | "companion";
  text: string;
}

/** The host's companion: a running notebook of topics and tasks, and a text line to it. */
export function CompanionPanel() {
  const conn = useDaemon((s) => s.conn);
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const c = getClient();
    if (conn !== "online" || !c) return;
    void c.fetchCompanionNotebook().then(setNotebook, () => {});
    return c.subscribeRawMessages((m) => {
      if (m.type === "companion.notebook.update") setNotebook(m.payload.notebook);
      if (m.type === "companion.reply" && m.payload.isFinal) setLines((l) => [...l, { who: "companion", text: m.payload.text }]);
    });
  }, [conn]);
  const send = (text: string) => {
    setLines((l) => [...l, { who: "you", text }]);
    getClient()?.sendCompanionMessage(text).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const entries = notebook?.entries ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Companion" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
        <GroupHead label="Notebook" count={entries.length} />
        {entries.length === 0 && (
          <T style={{ paddingHorizontal: 16, color: color.faint, lineHeight: 19 }}>
            Talk to the companion about your work; it keeps topics and tasks here and can start agents for them.
          </T>
        )}
        {entries.map((e) => (
          <View key={e.id} style={{ flexDirection: "row", gap: 10, marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: color.line }}>
            <View style={{ paddingTop: 5 }}>
              <StatusGlyph bucket={e.status === "done" ? "review" : e.status === "active" ? "working" : "idle"} size={8} />
            </View>
            <T style={{ flex: 1, color: e.status === "done" ? color.muted : color.text }}>{e.text}</T>
            <T v="mono" style={{ fontSize: 10.5 }}>{e.kind}</T>
          </View>
        ))}
        {lines.length > 0 && <GroupHead label="Conversation" />}
        {lines.map((l, i) => (
          <Cut key={i} size={8} flip={l.who === "you"} style={{ marginHorizontal: 12, marginBottom: 8, padding: 10, backgroundColor: l.who === "you" ? color.raise : color.panel }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
              {l.who === "companion" && <Bot size={12} color={color.cyan2} />}
              <T v="label">{l.who}</T>
            </View>
            <T style={{ lineHeight: 20 }}>{l.text}</T>
          </Cut>
        ))}
        {error && <T v="mono" style={{ color: color.coral, paddingHorizontal: 16 }}>{error}</T>}
      </ScrollView>
      <View style={{ padding: 10 }}>
        <Composer placeholder="Tell the companion…" chips={[]} onSend={send} compact />
      </View>
    </View>
  );
}
