import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { readText, setRoot, toggleDir, useFiles, type Entry } from "../daemon/files";
import { useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { useUi } from "../ui-store";
import { CodeBlock } from "./Code";
import { PanelHead } from "./PanelHead";
import { useActiveCwd } from "./ScmPanel";
import { Brackets } from "./SessionList";
import { T } from "./Text";

export function FilesPanel() {
  const cwd = useActiveCwd();
  const conn = useDaemon((s) => s.conn);
  useEffect(() => {
    if (cwd && conn === "online") void setRoot(cwd);
  }, [cwd, conn]);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Files" />
      <T v="mono" numberOfLines={1} style={{ paddingHorizontal: 14, paddingBottom: 8, fontSize: 11 }}>
        {cwd ? "…/" + cwd.split("/").slice(-2).join("/") : "open a session to browse its checkout"}
      </T>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
        <Dir path="." depth={0} />
      </ScrollView>
    </View>
  );
}

function Dir({ path, depth }: { path: string; depth: number }) {
  const listing = useFiles((s) => s.dirs[path]);
  if (!listing || listing === "loading") return <T v="label" style={{ paddingLeft: 16 + depth * 14, paddingVertical: 4 }}>…</T>;
  if ("error" in listing) return <T v="mono" style={{ color: color.coral, paddingLeft: 16 + depth * 14 }}>{listing.error}</T>;
  return (
    <>
      {listing.map((e) => <Node key={e.path} e={e} depth={depth} />)}
    </>
  );
}

function Node({ e, depth }: { e: Entry; depth: number }) {
  const open = useFiles((s) => !!s.expanded[e.path]);
  const { filePath, openFile } = useUi();
  const dir = e.kind === "directory";
  const on = filePath === e.path;
  const Icon = dir ? (open ? FolderOpen : Folder) : File;
  const Chev = open ? ChevronDown : ChevronRight;
  return (
    <>
      <Pressable onPress={() => (dir ? toggleDir(e.path) : openFile(e.path))}>
        {({ hovered }) => (
          <View style={[{ flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 8, paddingVertical: 5, paddingLeft: 6 + depth * 14, paddingRight: 8 }, hovered && { backgroundColor: color.wash }, on && { backgroundColor: "rgba(127,217,230,0.05)" }]}>
            {on && <Brackets len={6} />}
            {dir ? <Chev size={12} color={color.faint} /> : <View style={{ width: 12 }} />}
            <Icon size={14} color={dir ? color.cyan : on ? color.cyan2 : color.muted} strokeWidth={1.6} />
            <T numberOfLines={1} style={{ flex: 1, fontSize: 13, color: on ? color.cyan2 : color.text }}>{e.name}</T>
          </View>
        )}
      </Pressable>
      {dir && open && <Dir path={e.path} depth={depth + 1} />}
    </>
  );
}

export function FileViewer({ path, onBack }: { path: string; onBack?: () => void }) {
  const [state, setState] = useState<{ text: string | null; kind: string; size: number } | { error: string } | null>(null);
  useEffect(() => {
    setState(null);
    readText(path).then(setState, (e: unknown) => setState({ error: e instanceof Error ? e.message : String(e) }));
  }, [path]);
  const name = path.split("/").pop() ?? path;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: color.line }}>
        <T v="label">{path.split("/").slice(0, -1).join(" / ") || "file"}</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          {onBack && <Pressable onPress={onBack}><T style={{ color: color.cyan2, fontSize: 18 }}>←</T></Pressable>}
          <T v="display" style={{ fontSize: 19 }}>{name}</T>
          {state && "size" in state && <T v="mono" style={{ marginLeft: 8 }}>{(state.size / 1024).toFixed(1)} KB</T>}
        </View>
      </View>
      <ScrollView style={{ flex: 1 }}>
        {!state && <T v="label" style={{ padding: 24 }}>loading…</T>}
        {state && "error" in state && <T v="mono" style={{ color: color.coral, padding: 24 }}>{state.error}</T>}
        {state && "kind" in state && state.text === null && <T v="label" style={{ padding: 24 }}>{state.kind} file · no preview</T>}
        {state && "text" in state && state.text !== null && <CodeBlock code={state.text} filename={name} />}
      </ScrollView>
    </View>
  );
}
