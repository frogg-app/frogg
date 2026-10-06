import { ArrowDown, ArrowUp, GitBranch, RefreshCw } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useDaemon } from "../daemon/store";
import { commit, pull, push, useScm, watchCheckout, type DiffFile } from "../daemon/scm";
import { color, font, web } from "../theme/tokens";
import { useUi } from "../ui-store";
import { Button } from "./Button";
import { Cut } from "./Cut";
import { GroupHead, PanelHead } from "./PanelHead";
import { Brackets } from "./SessionList";
import { T } from "./Text";

/** The checkout source control works on: the open session's, else the most recent one. */
export function useActiveCwd(): string | null {
  const selected = useUi((s) => s.selected);
  return useDaemon((s) => {
    if (selected && s.sessions[selected]) return s.sessions[selected].agent.cwd;
    const all = Object.values(s.sessions).sort((a, b) => Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt));
    return all[0]?.agent.cwd ?? null;
  });
}

export function ScmPanel() {
  const cwd = useActiveCwd();
  const conn = useDaemon((s) => s.conn);
  const { status, files, busy, error } = useScm();
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (cwd && conn === "online") void watchCheckout(cwd);
  }, [cwd, conn]);
  const git = status && status.isGit ? status : null;
  const ab = git?.aheadBehind;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Source control">
        <Pressable onPress={() => cwd && void watchCheckout(cwd)}><RefreshCw size={14} color={color.faint} /></Pressable>
      </PanelHead>
      {!cwd && <T v="label" style={{ padding: 16 }}>open a session to see its checkout</T>}
      {git && (
        <Cut size={8} style={s.branch}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <GitBranch size={14} color={color.cyan2} />
            <T v="mono" style={{ color: color.text, fontSize: 13, fontWeight: "500" }}>{git.currentBranch ?? "detached"}</T>
          </View>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 6, marginLeft: 22 }}>
            <T v="mono" style={{ color: color.cyan2 }}>↑{ab?.ahead ?? 0}</T>
            <T v="mono">↓{ab?.behind ?? 0}</T>
            <T v="mono">vs {git.baseRef ?? "—"}</T>
          </View>
          <View style={{ flexDirection: "row", gap: 6, marginTop: 10 }}>
            <Button label={busy === "pull" ? "Pulling…" : "Pull"} icon={<ArrowDown size={12} color={color.text} />} onPress={() => void pull()} disabled={!git.hasRemote || !!busy} />
            <Button label={busy === "push" ? "Pushing…" : `Push${git.aheadOfOrigin ? ` ↑${git.aheadOfOrigin}` : ""}`} icon={<ArrowUp size={12} color={color.text} />} onPress={() => void push()} disabled={!git.hasRemote || !!busy} />
          </View>
        </Cut>
      )}
      {git && (
        <View style={{ paddingHorizontal: 12, gap: 8 }}>
          <TextInput
            value={msg}
            onChangeText={setMsg}
            multiline
            placeholder="Commit message"
            placeholderTextColor={color.faint}
            style={s.msg}
          />
          <Button
            kind="primary"
            label={busy === "commit" ? "Committing…" : `Commit ${files?.length ?? 0} file${files?.length === 1 ? "" : "s"}`}
            disabled={!msg.trim() || !files?.length || !!busy}
            onPress={() => void commit(msg.trim()).then(() => setMsg(""))}
          />
          {error && <T v="mono" style={{ color: color.coral }}>{error}</T>}
        </View>
      )}
      <ScrollView style={{ flex: 1 }}>
        {files && <GroupHead label="Changes" count={files.length} />}
        {files?.length === 0 && <T v="label" style={{ paddingHorizontal: 16 }}>working tree clean</T>}
        {files?.map((f) => <FileRow key={f.path} f={f} />)}
      </ScrollView>
    </View>
  );
}

function FileRow({ f }: { f: DiffFile }) {
  const on = useUi((s) => s.diffPath === f.path);
  const openDiff = useUi((s) => s.openDiff);
  const letter = f.isNew ? "A" : f.isDeleted ? "D" : "M";
  const tint = f.isNew ? color.mint : f.isDeleted ? color.coral : color.amber;
  const name = f.path.split("/").pop();
  const dir = f.path.slice(0, -(name?.length ?? 0) - 1);
  return (
    <Pressable onPress={() => openDiff(f.path)}>
      {({ hovered }) => (
        <View style={[s.file, hovered && { backgroundColor: color.wash }, on && { backgroundColor: "rgba(127,217,230,0.05)" }]}>
          {on && <Brackets />}
          <T v="mono" style={{ color: tint, width: 14, fontSize: 10.5 }}>{letter}</T>
          <View style={{ flex: 1 }}>
            <T numberOfLines={1} style={{ fontSize: 13 }}>{name}</T>
            {!!dir && <T numberOfLines={1} v="mono" style={{ fontSize: 10.5, color: color.faint }}>{dir}</T>}
          </View>
          <T v="mono" style={{ color: color.mint }}>+{f.additions}</T>
          <T v="mono" style={{ color: color.coral }}>-{f.deletions}</T>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  branch: { marginHorizontal: 12, marginBottom: 10, padding: 12, backgroundColor: color.panel },
  msg: {
    minHeight: 54, padding: 10, backgroundColor: color.panel, borderWidth: 1, borderColor: color.line,
    color: color.text, fontFamily: font.mono, fontSize: 12.5, ...web({ outlineStyle: "none", resize: "vertical" }),
  },
  file: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 8 },
});
