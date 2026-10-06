import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  GitBranch,
  MoreHorizontal,
  RefreshCw,
  Undo2,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useDaemon } from "../daemon/store";
import {
  commit,
  commitAndPush,
  createPr,
  discard,
  loadExtras,
  mergeFromBase,
  mergeIntoBase,
  pull,
  pullAndPush,
  push,
  stashPop,
  stashSave,
  useScm,
  useScmExtra,
  watchCheckout,
  type Commit,
  type DiffFile,
  type Stash,
} from "../daemon/scm";
import { ago } from "../util";
import { useFormFactor } from "../theme/layout";
import { BranchMenu } from "./tools/BranchMenu";
import { useConfirm, type ConfirmSpec } from "./tools/Confirm";
import { Menu, useAnchor, type MenuEntry } from "./tools/Menu";
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
  const ff = useFormFactor();
  const { status, files, busy, error } = useScm();
  const { commits, stashes } = useScmExtra();
  const diffPath = useUi((s) => s.diffPath);
  const openDiff = useUi((s) => s.openDiff);
  const { ask, dialog } = useConfirm();
  const more = useAnchor();
  useEffect(() => {
    if (cwd && conn === "online") void watchCheckout(cwd).then(() => loadExtras().catch(() => {}));
  }, [cwd, conn]);
  // Wide layouts always have something in the main pane: the first change, or the empty state.
  useEffect(() => {
    if (ff === "phone" || !files) return;
    if (diffPath && (diffPath !== "." || !files.length)) return;
    openDiff(files[0]?.path ?? ".");
  }, [ff, files, diffPath, openDiff]);
  const refresh = useCallback(() => {
    if (cwd) void watchCheckout(cwd).then(() => loadExtras().catch(() => {}));
  }, [cwd]);
  const git = status && status.isGit ? status : null;
  const sessionCommits = useMemo(() => commits?.filter((c) => !c.isOnBase) ?? null, [commits]);
  return (
    <View style={s.fill}>
      <PanelHead title="Source control">
        <Pressable onPress={refresh} accessibilityLabel="Refresh">
          <RefreshCw size={14} color={color.faint} />
        </Pressable>
        {git && (
          <View ref={more.ref} collapsable={false}>
            <Pressable onPress={more.open} accessibilityLabel="More source control actions">
              <MoreHorizontal size={15} color={color.faint} />
            </Pressable>
          </View>
        )}
      </PanelHead>
      {git && (
        <MoreMenu
          rect={more.rect}
          onClose={more.close}
          git={git}
          dirty={files?.length ?? 0}
          ask={ask}
        />
      )}
      {!cwd && (
        <T v="label" style={s.noCwd}>
          open a session to see its checkout
        </T>
      )}
      {status && !status.isGit && (
        <T v="label" style={s.noCwd}>
          this checkout is not a git repository
        </T>
      )}
      {git && <BranchCard git={git} busy={busy} dirty={files?.length ?? 0} />}
      {git && <CommitBox count={files?.length ?? 0} busy={busy} error={error} />}
      <ScrollView style={s.flex} contentContainerStyle={s.scrollPad}>
        {files && <GroupHead label="Changes" count={files.length} />}
        {files?.length === 0 && (
          <T v="label" style={s.clean}>
            working tree clean
          </T>
        )}
        {files?.map((f) => (
          <FileRow key={f.path} f={f} ask={ask} />
        ))}
        {!!sessionCommits?.length && (
          <GroupHead label="Session commits" count={sessionCommits.length} />
        )}
        {sessionCommits?.map((c) => (
          <CommitRow key={c.sha} c={c} />
        ))}
        {!!stashes?.length && <GroupHead label="Stashes" count={stashes.length} />}
        {stashes?.map((st) => (
          <StashRow key={`${st.index}:${st.message}`} st={st} ask={ask} />
        ))}
      </ScrollView>
      {dialog}
    </View>
  );
}

type Scm = ReturnType<typeof useScm.getState>;
type Git = Extract<NonNullable<Scm["status"]>, { isGit: true }>;
type Ask = (spec: ConfirmSpec) => void;

const onPull = () => void pull();
const onPush = () => void push();
const onMergeFromBase = () => void mergeFromBase();

function MoreMenu({
  rect,
  onClose,
  git,
  dirty,
  ask,
}: {
  rect: ReturnType<typeof useAnchor>["rect"];
  onClose: () => void;
  git: Git;
  dirty: number;
  ask: Ask;
}) {
  const pr = useScmExtra((st) => st.pr);
  const base = git.baseRef ?? "main";
  const ahead = git.aheadOfOrigin ?? 0;
  const items = useMemo<MenuEntry[]>(() => {
    const prOpen = pr && pr.state !== "merged" && pr.state !== "closed";
    return [
      {
        label: "Commit",
        kbd: "⌘↵",
        disabled: !dirty,
        hint: dirty ? undefined : "Nothing to commit",
        onPress: () => useScm.setState({ error: "Write a message in the box, then commit." }),
      },
      {
        label: "Commit and push",
        disabled: !dirty || !git.hasRemote,
        onPress: () =>
          ask({
            title: "Commit and push",
            body: `Commits all ${dirty} changed file${dirty === 1 ? "" : "s"} with an automatic message, then pushes.`,
            action: "Commit and push",
            run: () => void commitAndPush(`Update ${dirty} file${dirty === 1 ? "" : "s"}`),
          }),
      },
      { label: "Pull", disabled: !git.hasRemote, onPress: onPull },
      {
        label: "Push",
        hint: ahead ? `${ahead} commit${ahead === 1 ? "" : "s"} ahead` : undefined,
        disabled: !git.hasRemote,
        onPress: onPush,
      },
      { label: "Pull and push", disabled: !git.hasRemote, onPress: () => void pullAndPush() },
      "-",
      {
        label: `Update from ${base}`,
        hint: `merge ${base} into this branch`,
        onPress: onMergeFromBase,
      },
      {
        label: `Merge into ${base} locally`,
        disabled: dirty > 0,
        warn: dirty > 0,
        hint: dirty > 0 ? "Uncommitted changes · commit or stash first" : undefined,
        onPress: () =>
          ask({
            title: `Merge into ${base}`,
            body: `Merges ${git.currentBranch ?? "this branch"} into ${base} in the local repository.`,
            action: "Merge",
            run: () => void mergeIntoBase(),
          }),
      },
      "-",
      {
        label: "Create pull request",
        disabled: !!prOpen || !git.hasRemote,
        warn: !!prOpen,
        hint: prOpen && pr?.number ? `PR #${pr.number} already open` : undefined,
        onPress: () => void createPr(),
      },
      {
        label: "View pull request",
        disabled: !pr,
        onPress: () => pr && void Linking.openURL(pr.url),
      },
      "-",
      {
        label: "Stash changes",
        disabled: !dirty,
        onPress: () => void stashSave(),
      },
    ];
  }, [pr, dirty, git, ahead, base, ask]);
  return <Menu rect={rect} onClose={onClose} items={items} width={280} />;
}

function BranchCard({ git, busy, dirty }: { git: Git; busy: Scm["busy"]; dirty: number }) {
  const ab = git.aheadBehind;
  const anchor = useAnchor();
  const ahead = git.aheadOfOrigin ?? 0;
  return (
    <Cut size={8} style={s.branch}>
      <View ref={anchor.ref} collapsable={false}>
        <Pressable onPress={anchor.open} accessibilityLabel="Switch branch">
          {({ hovered }) => (
            <View style={s.branchHead}>
              <GitBranch size={14} color={color.cyan2} />
              <T v="mono" style={[s.branchName, hovered && s.branchNameHover]} numberOfLines={1}>
                {git.currentBranch ?? "detached"}
              </T>
              <ChevronDown size={12} color={color.faint} />
            </View>
          )}
        </Pressable>
      </View>
      <BranchMenu
        rect={anchor.rect}
        onClose={anchor.close}
        current={git.currentBranch}
        dirty={dirty}
      />
      <View style={s.counts}>
        <T v="mono" style={s.ahead}>
          ↑{ab?.ahead ?? 0}
        </T>
        <T v="mono">↓{ab?.behind ?? 0}</T>
        <T v="mono">vs {git.baseRef ?? "—"}</T>
        {busy === "switch" && <T v="mono">switching…</T>}
        {busy === "stash" && <T v="mono">stashing…</T>}
        {busy === "merge" && <T v="mono">merging…</T>}
      </View>
      <View style={s.syncRow}>
        <Button
          label={busy === "pull" ? "Pulling…" : "Pull"}
          icon={ArrowDown}
          onPress={onPull}
          disabled={!git.hasRemote || !!busy}
        />
        <Button
          label={busy === "push" ? "Pushing…" : `Push${ahead ? ` ↑${ahead}` : ""}`}
          icon={ArrowUp}
          onPress={onPush}
          disabled={!git.hasRemote || !!busy}
        />
        {!!git.baseRef && git.currentBranch !== git.baseRef && (
          <Button
            label={`Update from ${git.baseRef}`}
            onPress={onMergeFromBase}
            disabled={!!busy}
          />
        )}
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
  const anchor = useAnchor();
  const onCommit = useCallback(() => void commit(msg.trim()).then(() => setMsg("")), [msg]);
  const items = useMemo<MenuEntry[]>(
    () => [
      { label: "Commit", kbd: "⌘↵", onPress: onCommit },
      {
        label: "Commit and push",
        onPress: () => void commitAndPush(msg.trim()).then(() => setMsg("")),
      },
    ],
    [onCommit, msg],
  );
  const can = !!msg.trim() && !!count && !busy;
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
      <View style={s.commitRow}>
        <Button
          kind="primary"
          grow
          label={
            busy === "commit" ? "Committing…" : `Commit ${count} file${count === 1 ? "" : "s"}`
          }
          disabled={!can}
          onPress={onCommit}
        />
        <View ref={anchor.ref} collapsable={false}>
          <Pressable
            onPress={anchor.open}
            disabled={!can}
            style={s.commitMore}
            accessibilityLabel="More commit options"
          >
            <ChevronDown size={13} color={can ? color.muted : color.faint} />
          </Pressable>
        </View>
      </View>
      <Menu rect={anchor.rect} onClose={anchor.close} items={items} right width={220} />
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

function FileRow({ f, ask }: { f: DiffFile; ask: Ask }) {
  const on = useUi((s) => s.diffPath === f.path);
  const openDiff = useUi((s) => s.openDiff);
  const press = useCallback(() => openDiff(f.path), [openDiff, f.path]);
  const onDiscard = useCallback(
    () =>
      ask({
        eyebrow: "Source control",
        title: `Discard changes to ${f.path.split("/").pop()}?`,
        body: f.isNew
          ? "This file is new; discarding deletes it. This cannot be undone."
          : "Restores the file to its last committed state. This cannot be undone.",
        action: "Discard changes",
        danger: true,
        run: () => void discard([f.path]),
      }),
    [ask, f.path, f.isNew],
  );
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
          {(hovered || on) && (
            <Pressable onPress={onDiscard} hitSlop={6} accessibilityLabel={`Discard ${name}`}>
              <Undo2 size={13} color={color.faint} />
            </Pressable>
          )}
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

function CommitRow({ c }: { c: Commit }) {
  return (
    <View style={s.line}>
      <T v="mono" style={s.sha}>
        {c.shortSha}
      </T>
      <T numberOfLines={1} style={s.lineText}>
        {c.subject}
      </T>
      {!c.isOnRemote && <View style={s.localDot} />}
      <T v="mono" style={s.when}>
        {ago(c.authorDate)}
      </T>
    </View>
  );
}

function StashRow({ st, ask }: { st: Stash; ask: Ask }) {
  const press = useCallback(
    () =>
      ask({
        eyebrow: `stash@{${st.index}}`,
        title: "Apply and drop this stash?",
        body: st.message,
        action: "Pop stash",
        run: () => void stashPop(st.index),
      }),
    [ask, st],
  );
  return (
    <Pressable onPress={press}>
      {({ hovered }) => (
        <View style={[s.line, hovered && s.fileHover]}>
          <T v="mono" style={s.sha}>
            stash@{"{"}
            {st.index}
            {"}"}
          </T>
          <T numberOfLines={1} style={s.lineText}>
            {st.message}
          </T>
          {st.branch && (
            <T v="mono" style={s.when} numberOfLines={1}>
              {st.branch}
            </T>
          )}
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  flex: { flex: 1 },
  scrollPad: { paddingBottom: 16 },
  noCwd: { padding: 16 },
  clean: { paddingHorizontal: 16 },
  branchHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  branchName: { color: color.text, fontSize: 13, fontWeight: "500", flexShrink: 1 },
  branchNameHover: { color: color.cyan2 },
  counts: { flexDirection: "row", gap: 10, marginTop: 6, marginLeft: 22 },
  ahead: { color: color.cyan2 },
  syncRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  commitBox: { paddingHorizontal: 12, gap: 8 },
  commitRow: { flexDirection: "row", alignItems: "stretch", gap: 4 },
  commitMore: {
    width: 30,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.line2,
  },
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
  line: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  sha: { color: color.cyan2, fontSize: 11 },
  lineText: { flex: 1, fontSize: 12.5 },
  localDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: color.amber },
  when: { fontSize: 10.5, color: color.faint, maxWidth: 90 },
});
