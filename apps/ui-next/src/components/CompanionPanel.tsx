import { Bot } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { getClient, useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { Composer } from "./Composer";
import { Cut } from "./Cut";
import { GroupHead, PanelHead } from "./PanelHead";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";

type Notebook = Awaited<
  ReturnType<NonNullable<ReturnType<typeof getClient>>["fetchCompanionNotebook"]>
>;
type Entry = Notebook["entries"][number];
interface Line {
  who: "you" | "companion";
  text: string;
  id: number;
}

let lineSeq = 0;
const NO_CHIPS: never[] = [];

function bucketOf(status: Entry["status"]) {
  if (status === "done") return "review";
  if (status === "active") return "working";
  return "idle";
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
      if (m.type === "companion.reply" && m.payload.isFinal)
        setLines((l) => [...l, { who: "companion", text: m.payload.text, id: ++lineSeq }]);
    });
  }, [conn]);
  const send = useCallback((text: string) => {
    setLines((l) => [...l, { who: "you", text, id: ++lineSeq }]);
    getClient()
      ?.sendCompanionMessage(text)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const entries = notebook?.entries ?? [];
  return (
    <View style={st.fill}>
      <PanelHead title="Companion" />
      <ScrollView style={st.flex} contentContainerStyle={st.content}>
        <GroupHead label="Notebook" count={entries.length} />
        {entries.length === 0 && (
          <T style={st.empty}>
            Talk to the companion about your work; it keeps topics and tasks here and can start
            agents for them.
          </T>
        )}
        {entries.map((e) => (
          <View key={e.id} style={st.entry}>
            <View style={st.glyph}>
              <StatusGlyph bucket={bucketOf(e.status)} size={8} />
            </View>
            <T style={[st.entryText, e.status === "done" && st.entryDone]}>{e.text}</T>
            <T v="mono" style={st.kind}>
              {e.kind}
            </T>
          </View>
        ))}
        {lines.length > 0 && <GroupHead label="Conversation" />}
        {lines.map((l) => (
          <Cut
            key={l.id}
            size={8}
            flip={l.who === "you"}
            style={[st.bubble, l.who === "you" && st.bubbleYou]}
          >
            <View style={st.who}>
              {l.who === "companion" && <Bot size={12} color={color.cyan2} />}
              <T v="label">{l.who}</T>
            </View>
            <T style={st.lineText}>{l.text}</T>
          </Cut>
        ))}
        {error && (
          <T v="mono" style={st.error}>
            {error}
          </T>
        )}
      </ScrollView>
      <View style={st.composer}>
        <Composer placeholder="Tell the companion…" chips={NO_CHIPS} onSend={send} compact />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  flex: { flex: 1 },
  content: { paddingBottom: 12 },
  empty: { paddingHorizontal: 16, color: color.faint, lineHeight: 19 },
  entry: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  glyph: { paddingTop: 5 },
  entryText: { flex: 1, color: color.text },
  entryDone: { color: color.muted },
  kind: { fontSize: 10.5 },
  bubble: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    backgroundColor: color.panel,
  },
  bubbleYou: { backgroundColor: color.raise },
  who: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  lineText: { lineHeight: 20 },
  error: { color: color.coral, paddingHorizontal: 16 },
  composer: { padding: 10 },
});
