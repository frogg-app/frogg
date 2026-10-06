import { ChevronRight } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { newTerminal } from "../daemon/terminals";
import { answerPermission, useDaemon } from "../daemon/store";
import { bucketOf } from "../daemon/types";
import { color, font, web } from "../theme/tokens";
import { useUi } from "../ui-store";
import { Cut } from "./Cut";
import { TOOLS } from "./Rail";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";

interface Item {
  id: string;
  group: "Sessions" | "Commands" | "Go to";
  label: string;
  hint?: string;
  kbd?: string;
  glyph?: ReturnType<typeof bucketOf>;
  run: () => void;
}

const ORDER = ["needs", "failed", "review", "working", "idle"];

/** Session ids in the order the list shows them, for J / K. */
function orderedSessionIds(): string[] {
  return Object.values(useDaemon.getState().sessions)
    .sort((a, b) => ORDER.indexOf(bucketOf(a.agent)) - ORDER.indexOf(bucketOf(b.agent)) || Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt))
    .map((s) => s.agent.id);
}

/** ⌘K / Ctrl+K anywhere; `>` narrows to commands; J / K move through sessions; A / Esc answer a permission. */
export function useGlobalKeys() {
  const setPalette = useUi((s) => s.setPalette);
  useEffect(() => {
    const doc = (globalThis as { document?: Document }).document;
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA)$/.test((e.target as HTMLElement | null)?.tagName ?? "") || (e.target as HTMLElement | null)?.isContentEditable;
      const ui = useUi.getState();
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && !ui.paletteOpen && !ui.newSessionOpen) {
        const k = e.key.toLowerCase();
        if (k === "j" || k === "k") {
          const order = orderedSessionIds();
          const at = ui.selected ? order.indexOf(ui.selected) : -1;
          const next = order[Math.max(0, Math.min(order.length - 1, at + (k === "j" ? 1 : -1)))];
          if (next) {
            ui.setTool("sessions");
            ui.select(next);
          }
          e.preventDefault();
          return;
        }
        const agent = ui.selected ? useDaemon.getState().sessions[ui.selected]?.agent : undefined;
        const perm = agent?.pendingPermissions[0];
        if (agent && perm && (k === "a" || k === "escape")) {
          void answerPermission(agent.id, perm.id, k === "a");
          e.preventDefault();
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        useUi.getState().setNewSession(true);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(!useUi.getState().paletteOpen);
      }
    };
    doc.addEventListener("keydown", onKey);
    return () => doc.removeEventListener("keydown", onKey);
  }, [setPalette]);
}

export function Palette() {
  const open = useUi((s) => s.paletteOpen);
  const ui = useUi();
  const sessions = useDaemon((s) => s.sessions);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const close = () => {
    ui.setPalette(false);
    setQ("");
    setCursor(0);
  };
  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    for (const s of Object.values(sessions).sort((a, b) => Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt)))
      list.push({
        id: s.agent.id, group: "Sessions", label: s.agent.title || "Untitled session", hint: s.project?.projectName,
        glyph: bucketOf(s.agent), run: () => { ui.setTool("sessions"); ui.select(s.agent.id); },
      });
    list.push(
      { id: "new-session", group: "Commands", label: "New session", kbd: "⌘N", run: () => ui.setNewSession(true) },
      { id: "new-term", group: "Commands", label: "New terminal", kbd: "⌃`", run: () => { ui.setTool("terminals"); void newTerminal().then((id) => id && ui.openTerminal(id)); } },
      { id: "home", group: "Commands", label: "Start something (home)", run: () => { ui.setTool("sessions"); ui.select(null); } },
    );
    for (const t of TOOLS) list.push({ id: `go-${t.id}`, group: "Go to", label: t.label, run: () => ui.setTool(t.id) });
    const commandsOnly = q.startsWith(">");
    const needle = (commandsOnly ? q.slice(1) : q).trim().toLowerCase();
    return list.filter(
      (i) => (!commandsOnly || i.group !== "Sessions") && (!needle || `${i.label} ${i.hint ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [sessions, q, ui]);
  if (!open) return null;
  const pick = (i: Item | undefined) => {
    if (!i) return;
    close();
    i.run();
  };
  let lastGroup = "";
  return (
    <View style={s.layer}>
      <Pressable style={s.scrim} onPress={close} />
      <Cut size={14} flip style={s.box}>
        <TextInput
          autoFocus
          value={q}
          onChangeText={(t) => { setQ(t); setCursor(0); }}
          placeholder="Search sessions, commands, tools…"
          placeholderTextColor={color.faint}
          style={s.input}
          onKeyPress={(e) => {
            const k = (e.nativeEvent as { key: string }).key;
            if (k === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, items.length - 1)); }
            else if (k === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
            else if (k === "Enter") { e.preventDefault(); pick(items[cursor]); }
            else if (k === "Escape") close();
          }}
        />
        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
          {items.length === 0 && <T v="label" style={{ padding: 16 }}>no matches</T>}
          {items.map((i, n) => {
            const head = i.group !== lastGroup ? (lastGroup = i.group) : null;
            const on = n === cursor;
            return (
              <View key={i.id}>
                {head && <T v="label" style={s.group}>{head}</T>}
                <Pressable onPress={() => pick(i)} onHoverIn={() => setCursor(n)}>
                  <View style={[s.row, on && s.rowOn]}>
                    {i.glyph ? <StatusGlyph bucket={i.glyph} size={8} /> : <ChevronRight size={13} color={color.faint} />}
                    <T numberOfLines={1} style={{ flex: 1, color: on ? color.cyan2 : color.text }}>{i.label}</T>
                    {i.hint && <T v="mono" style={{ fontSize: 11 }}>{i.hint}</T>}
                    {i.kbd && <T v="mono" style={s.kbd}>{i.kbd}</T>}
                  </View>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
        <View style={s.foot}>
          {[["↑↓", "move"], ["↵", "run"], [">", "commands only"], ["esc", "close"]].map(([k, l]) => (
            <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <T v="mono" style={s.kbd}>{k}</T>
              <T style={{ fontSize: 11.5, color: color.faint }}>{l}</T>
            </View>
          ))}
        </View>
      </Cut>
    </View>
  );
}

const s = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, alignItems: "center", paddingTop: "12%", paddingHorizontal: 12, zIndex: 50 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(4,8,10,0.6)", ...web({ backdropFilter: "blur(6px)" }) },
  box: { width: "100%", maxWidth: 620, backgroundColor: color.panel, borderWidth: 1, borderColor: color.line2 },
  input: {
    paddingHorizontal: 18, paddingVertical: 16, fontSize: 16, color: color.text, fontFamily: font.body,
    borderBottomWidth: 1, borderBottomColor: color.line, ...web({ outlineStyle: "none" }),
  },
  group: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 6, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: "transparent" },
  rowOn: { backgroundColor: "rgba(37,181,200,0.1)", borderColor: "rgba(127,217,230,0.35)" },
  kbd: { fontSize: 10, paddingHorizontal: 5, borderWidth: 1, borderColor: color.line2, color: color.muted },
  foot: { flexDirection: "row", flexWrap: "wrap", gap: 16, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: color.line },
});
