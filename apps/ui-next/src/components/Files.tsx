import { ChevronDown, ChevronRight, File, Folder, FolderOpen } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
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
    <View style={st.fill}>
      <PanelHead title="Files" />
      <T v="mono" numberOfLines={1} style={st.cwd}>
        {cwd ? "…/" + cwd.split("/").slice(-2).join("/") : "open a session to browse its checkout"}
      </T>
      <ScrollView style={st.flex} contentContainerStyle={st.scrollPad}>
        <Dir path="." depth={0} />
      </ScrollView>
    </View>
  );
}

function Dir({ path, depth }: { path: string; depth: number }) {
  const listing = useFiles((s) => s.dirs[path]);
  const indent = useMemo(() => ({ paddingLeft: 16 + depth * 14 }), [depth]);
  if (!listing || listing === "loading")
    return (
      <T v="label" style={[st.loadingRow, indent]}>
        …
      </T>
    );
  if ("error" in listing)
    return (
      <T v="mono" style={[st.error, indent]}>
        {listing.error}
      </T>
    );
  return listing.map((e) => <Node key={e.path} e={e} depth={depth} />);
}

function iconFor(dir: boolean, open: boolean) {
  if (!dir) return File;
  return open ? FolderOpen : Folder;
}

function iconColor(dir: boolean, on: boolean) {
  if (dir) return color.cyan;
  return on ? color.cyan2 : color.muted;
}

function Node({ e, depth }: { e: Entry; depth: number }) {
  const open = useFiles((s) => !!s.expanded[e.path]);
  const { filePath, openFile } = useUi();
  const dir = e.kind === "directory";
  const on = filePath === e.path;
  const Icon = iconFor(dir, open);
  const Chev = open ? ChevronDown : ChevronRight;
  const onPress = useCallback(
    () => (dir ? toggleDir(e.path) : openFile(e.path)),
    [dir, e.path, openFile],
  );
  const indent = useMemo(() => ({ paddingLeft: 6 + depth * 14 }), [depth]);
  return (
    <>
      <Pressable onPress={onPress}>
        {({ hovered }) => (
          <View style={[st.node, indent, hovered && st.hovered, on && st.nodeOn]}>
            {on && <Brackets len={6} />}
            {dir ? <Chev size={12} color={color.faint} /> : <View style={st.chevSpacer} />}
            <Icon size={14} color={iconColor(dir, on)} strokeWidth={1.6} />
            <T numberOfLines={1} style={[st.nodeName, on && st.nodeNameOn]}>
              {e.name}
            </T>
          </View>
        )}
      </Pressable>
      {dir && open && <Dir path={e.path} depth={depth + 1} />}
    </>
  );
}

export function FileViewer({ path, onBack }: { path: string; onBack?: () => void }) {
  const [state, setState] = useState<
    { text: string | null; kind: string; size: number } | { error: string } | null
  >(null);
  useEffect(() => {
    setState(null);
    readText(path).then(setState, (e: unknown) =>
      setState({ error: e instanceof Error ? e.message : String(e) }),
    );
  }, [path]);
  const name = path.split("/").pop() ?? path;
  return (
    <View style={st.fill}>
      <View style={st.viewerHead}>
        <T v="label">{path.split("/").slice(0, -1).join(" / ") || "file"}</T>
        <View style={st.titleRow}>
          {onBack && (
            <Pressable onPress={onBack}>
              <T style={st.back}>←</T>
            </Pressable>
          )}
          <T v="display" style={st.title}>
            {name}
          </T>
          {state && "size" in state && (
            <T v="mono" style={st.size}>
              {(state.size / 1024).toFixed(1)} KB
            </T>
          )}
        </View>
      </View>
      <ScrollView style={st.flex}>
        {!state && (
          <T v="label" style={st.pad}>
            loading…
          </T>
        )}
        {state && "error" in state && (
          <T v="mono" style={st.viewerError}>
            {state.error}
          </T>
        )}
        {state && "kind" in state && state.text === null && (
          <T v="label" style={st.pad}>
            {state.kind} file · no preview
          </T>
        )}
        {state && "text" in state && state.text !== null && (
          <CodeBlock code={state.text} filename={name} />
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  flex: { flex: 1 },
  cwd: { paddingHorizontal: 14, paddingBottom: 8, fontSize: 11 },
  scrollPad: { paddingBottom: 16 },
  loadingRow: { paddingVertical: 4 },
  error: { color: color.coral },
  node: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 8,
    paddingVertical: 5,
    paddingRight: 8,
  },
  hovered: { backgroundColor: color.wash },
  nodeOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  chevSpacer: { width: 12 },
  nodeName: { flex: 1, fontSize: 13, color: color.text },
  nodeNameOn: { color: color.cyan2 },
  viewerHead: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  back: { color: color.cyan2, fontSize: 18 },
  title: { fontSize: 19 },
  size: { marginLeft: 8 },
  pad: { padding: 24 },
  viewerError: { color: color.coral, padding: 24 },
});
