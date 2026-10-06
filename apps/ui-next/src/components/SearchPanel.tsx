import { Archive } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { getClient, useDaemon } from "../daemon/store";
import { bucketOf, type Placement, type Agent } from "../daemon/types";
import { color, font, web } from "../theme/tokens";
import { useUi } from "../ui-store";
import { ago } from "../util";
import { Cut } from "./Cut";
import { GroupHead, PanelHead } from "./PanelHead";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";

interface Hit {
  agent: Agent;
  project: Placement;
  ranges: Array<{ start: number; length: number }>;
}

/** Searches every session on the host, archived ones included, as you type. */
export function SearchPanel() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setHits(null);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      const res = await getClient()?.fetchAgentHistory({ search: text, page: { limit: 50 } });
      if (!res || mine !== seq.current) return;
      setTruncated(!!res.searchTruncated);
      setHits(
        res.entries.map((e) => ({
          agent: e.agent,
          project: e.project,
          ranges: e.searchMatches?.find((m) => m.field === "title")?.ranges ?? [],
        })),
      );
    }, 160);
    return () => clearTimeout(timer);
  }, [q]);
  const open = (h: Hit) => {
    useDaemon.setState((st) => ({ sessions: st.sessions[h.agent.id] ? st.sessions : { ...st.sessions, [h.agent.id]: { agent: h.agent, project: h.project } } }));
    useUi.getState().setTool("sessions");
    useUi.getState().select(h.agent.id);
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Search" />
      <Cut size={6} style={s.box}>
        <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Sessions by title, branch or project" placeholderTextColor={color.faint} style={s.input} />
      </Cut>
      <ScrollView style={{ flex: 1 }}>
        {!hits && <T v="label" style={{ padding: 16 }}>all sessions on this host, archived included</T>}
        {hits && <GroupHead label="Sessions" count={hits.length} />}
        {hits?.length === 0 && <T style={{ paddingHorizontal: 16, color: color.faint }}>No sessions match.</T>}
        {hits?.map((h) => {
          const branch = h.project.checkout.isGit ? h.project.checkout.currentBranch : null;
          return (
            <Pressable key={h.agent.id} onPress={() => open(h)}>
              {({ hovered }) => (
                <View style={[s.row, hovered && { backgroundColor: color.wash }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {h.agent.archivedAt ? <Archive size={11} color={color.faint} /> : <StatusGlyph bucket={bucketOf(h.agent)} size={8} />}
                    <T numberOfLines={1} style={{ flex: 1 }}><Marked text={h.agent.title || "Untitled session"} ranges={h.ranges} /></T>
                    <T v="mono" style={{ fontSize: 10.5 }}>{ago(h.agent.updatedAt)}</T>
                  </View>
                  <T v="mono" numberOfLines={1} style={{ marginLeft: 17, marginTop: 3, fontSize: 11 }}>
                    {[h.project.projectName, branch].filter(Boolean).join(" · ")}
                  </T>
                </View>
              )}
            </Pressable>
          );
        })}
        {truncated && <T v="label" style={{ padding: 16 }}>more matches · narrow the query</T>}
      </ScrollView>
    </View>
  );
}

function Marked({ text, ranges }: { text: string; ranges: Array<{ start: number; length: number }> }) {
  if (!ranges.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let at = 0;
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    if (r.start > at) out.push(text.slice(at, r.start));
    out.push(<T key={r.start} style={{ color: color.cyan2, backgroundColor: "rgba(127,217,230,0.12)" }}>{text.slice(r.start, r.start + r.length)}</T>);
    at = r.start + r.length;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

const s = StyleSheet.create({
  box: { marginHorizontal: 12, marginBottom: 6, backgroundColor: color.panel, borderWidth: 1, borderColor: color.line2 },
  input: { paddingHorizontal: 10, paddingVertical: 8, color: color.text, fontFamily: font.body, fontSize: 13.5, ...web({ outlineStyle: "none" }) },
  row: { marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: color.line },
});
