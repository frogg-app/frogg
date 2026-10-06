import { ArrowDown, ArrowUp, GitBranch, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
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
    const all = Object.values(s.sessions).sort(
      (a, b) => Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt),
    );
    return all[0]?.agent.cwd ?? null;
  });
}

export function ScmPanel() {
  const cwd = useActiveCwd();
  const conn = useDaemon((s) => s.conn);
  const { status, files, busy, error } = useScm();
  useEffect(() => {
    if (cwd && conn === "online") void watchCheckout(cwd);
  }, [cwd, conn]);
  const refresh = useCallback(() => cwd && void watchCheckout(cwd), [cwd]);
  const git = status && status.isGit ? status : null;
  return (
    <View style={s.fill}>
      <PanelHead title="Source control">
        <Pressable onPress={refresh}>
          <RefreshCw size={14} color={color.faint} />
        </Pressable>
      </PanelHead>
      {!cwd && (
        <T v="label" style={s.noCwd}>
          open a session to see its checkout
        </T>
      )}
      {git && <BranchCard git={git} busy={busy} />}
      {git && <CommitBox count={files?.length ?? 0} busy={busy} error={error} />}
      <ScrollView style={s.flex}>
        {files && <GroupHead label="Changes" count={files.length} />}
        {files?.length === 0 && (
          <T v="label" style={s.clean}>
            working tree clean
          </T>
        )}
        {files?.map((f) => (
          <FileRow key={f.path} f={f} />
        ))}
      </ScrollView>
    </View>
  );
}

type Scm = ReturnType<typeof useScm.getState>;
type Git = Extract<NonNullable<Scm["status"]>, { isGit: true }>;

const onPull = () => void pull();
const onPush = () => void push();

function BranchCard({ git, busy }: { git: Git; busy: Scm["busy"] }) {
  const ab = git.aheadBehind;
  return (
    <Cut size={8} style={s.branch}>
      <View style={s.branchHead}>
        <GitBranch size={14} color={color.cyan2} />
        <T v="mono" style={s.branchName}>
          {git.currentBranch ?? "detached"}
        </T>
      </View>
      <View style={s.counts}>
        <T v="mono" style={s.ahead}>
          ↑{ab?.ahead ?? 0}
        </T>
        <T v="mono">↓{ab?.behind ?? 0}</T>
        <T v="mono">vs {git.baseRef ?? "—"}</T>
      </View>
      <View style={s.syncRow}>
        <Button
          label={busy === "pull" ? "Pulling…" : "Pull"}
          icon={ArrowDown}
          onPress={onPull}
          disabled={!git.hasRemote || !!busy}
        />
        <Button
          label={
            busy === "push"
              ? "Pushing…"
              : `Push${git.aheadOfOrigin ? ` ↑${git.aheadOfOrigin}` : ""}`
          }
          icon={ArrowUp}
          onPress={onPush}
          disabled={!git.hasRemote || !!busy}
        />
      </View>
    </Cut>
  );
}

function CommitBox({
  count,
  busy,
  error,
}: {
  count: number;
  busy: Scm["busy"];
  error: Scm["error"];
}) {
  const [msg, setMsg] = useState("");
  const onCommit = useCallback(() => void commit(msg.trim()).then(() => setMsg("")), [msg]);
  return (
    <View style={s.commitBox}>
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
        label={busy === "commit" ? "Committing…" : `Commit ${count} file${count === 1 ? "" : "s"}`}
        disabled={!msg.trim() || !count || !!busy}
        onPress={onCommit}
      />
      {error && (
        <T v="mono" style={s.error}>
          {error}
        </T>
      )}
    </View>
  );
}

function fileKind(f: DiffFile): { letter: string; tint: string } {
  if (f.isNew) return { letter: "A", tint: color.mint };
  if (f.isDeleted) return { letter: "D", tint: color.coral };
  return { letter: "M", tint: color.amber };
}

function FileRow({ f }: { f: DiffFile }) {
  const on = useUi((s) => s.diffPath === f.path);
  const openDiff = useUi((s) => s.openDiff);
  const press = useCallback(() => openDiff(f.path), [openDiff, f.path]);
  const { letter, tint } = fileKind(f);
  const letterStyle = useMemo(() => [s.letter, { color: tint }], [tint]);
  const name = f.path.split("/").pop();
  const dir = f.path.slice(0, -(name?.length ?? 0) - 1);
  return (
    <Pressable onPress={press}>
      {({ hovered }) => (
        <View style={[s.file, hovered && s.fileHover, on && s.fileOn]}>
          {on && <Brackets />}
          <T v="mono" style={letterStyle}>
            {letter}
          </T>
          <View style={s.flex}>
            <T numberOfLines={1} style={s.fileName}>
              {name}
            </T>
            {!!dir && (
              <T numberOfLines={1} v="mono" style={s.dir}>
                {dir}
              </T>
            )}
          </View>
          <T v="mono" style={s.add}>
            +{f.additions}
          </T>
          <T v="mono" style={s.del}>
            -{f.deletions}
          </T>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  flex: { flex: 1 },
  noCwd: { padding: 16 },
  clean: { paddingHorizontal: 16 },
  branchHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  branchName: { color: color.text, fontSize: 13, fontWeight: "500" },
  counts: { flexDirection: "row", gap: 10, marginTop: 6, marginLeft: 22 },
  ahead: { color: color.cyan2 },
  syncRow: { flexDirection: "row", gap: 6, marginTop: 10 },
  commitBox: { paddingHorizontal: 12, gap: 8 },
  error: { color: color.coral },
  fileHover: { backgroundColor: color.wash },
  fileOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  letter: { width: 14, fontSize: 10.5 },
  fileName: { fontSize: 13 },
  dir: { fontSize: 10.5, color: color.faint },
  add: { color: color.mint },
  del: { color: color.coral },
  branch: {
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 12,
    backgroundColor: color.panel,
  },
  msg: {
    minHeight: 54,
    padding: 10,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12.5,
    ...web({ outlineStyle: "none", resize: "vertical" }),
  },
  file: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
});
