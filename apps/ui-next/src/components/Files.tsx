import {
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  closeTabs,
  deleteEntry,
  duplicateEntry,
  fileParent,
  loadDir,
  renameEntry,
  setRoot,
  toggleDir,
  useFiles,
  type Entry,
} from "../daemon/files";
import { discard, useScm } from "../daemon/scm";
import { useDaemon } from "../daemon/store";
import { anim, color, ease, frames, web } from "../theme/tokens";
import { useUi } from "../ui-store";

import { PanelHead } from "./PanelHead";
import { SkeletonRows } from "./Skeleton";
import { useActiveCwd } from "./ScmPanel";
import { Brackets, BracketScope } from "./Brackets";

import { T } from "./Text";
import { copyText } from "./tools/clipboard";
import { useConfirm, type ConfirmSpec } from "./tools/Confirm";
import { Menu, useAnchor, type MenuEntry } from "./tools/Menu";
import { usePrompt, type PromptSpec } from "./tools/Prompt";

export { FileViewer } from "./tools/FileViewer";

import { newEntrySpec } from "./tools/fileActions";

type Ask = (spec: ConfirmSpec) => void;
type Prompt = (spec: PromptSpec) => void;

/** Change letters for files in the checkout's diff, keyed by path. */
function useChangeMarks(): Record<string, { letter: string; tint: string }> {
  const files = useScm((st) => st.files);
  return useMemo(() => {
    const out: Record<string, { letter: string; tint: string }> = {};
    for (const f of files ?? []) {
      if (f.isNew) out[f.path] = { letter: "A", tint: color.mint };
      else if (f.isDeleted) out[f.path] = { letter: "D", tint: color.coral };
      else out[f.path] = { letter: "M", tint: color.amber };
    }
    return out;
  }, [files]);
}

export function FilesPanel() {
  const cwd = useActiveCwd();
  const conn = useDaemon((s) => s.conn);
  const branch = useScm((st) => (st.status?.isGit ? st.status.currentBranch : null));
  const confirm = useConfirm();
  const prompt = usePrompt();
  useEffect(() => {
    if (cwd && conn === "online") void setRoot(cwd);
  }, [cwd, conn]);
  const marks = useChangeMarks();
  const refresh = useCallback(() => void loadDir("."), []);
  const newFile = useCallback(
    () => prompt.ask(newEntrySpec(".", "file", useUi.getState().openFile)),
    [prompt],
  );
  const newFolder = useCallback(
    () => prompt.ask(newEntrySpec(".", "directory", useUi.getState().openFile)),
    [prompt],
  );
  return (
    <View style={st.fill}>
      <PanelHead title="Files">
        <Pressable onPress={newFile} accessibilityLabel="New file" disabled={!cwd}>
          <FilePlus size={14} color={color.faint} />
        </Pressable>
        <Pressable onPress={newFolder} accessibilityLabel="New folder" disabled={!cwd}>
          <FolderPlus size={14} color={color.faint} />
        </Pressable>
        <Pressable onPress={refresh} accessibilityLabel="Refresh files">
          <RefreshCw size={14} color={color.faint} />
        </Pressable>
      </PanelHead>
      <View style={st.rootRow}>
        <T numberOfLines={1} style={st.rootName}>
          {cwd ? cwd.split("/").pop() : "open a session to browse its checkout"}
        </T>
        {branch && (
          <T v="mono" numberOfLines={1} style={st.rootBranch}>
            ⎇ {branch}
          </T>
        )}
      </View>
      <ScrollView style={st.flex} contentContainerStyle={st.scrollPad}>
        <BracketScope>
          <Dir path="." depth={0} marks={marks} ask={confirm.ask} prompt={prompt.ask} />
        </BracketScope>
      </ScrollView>
      {confirm.dialog}
      {prompt.dialog}
    </View>
  );
}

function Dir({
  path,
  depth,
  marks,
  ask,
  prompt,
}: {
  path: string;
  depth: number;
  marks: ReturnType<typeof useChangeMarks>;
  ask: Ask;
  prompt: Prompt;
}) {
  const listing = useFiles((s) => s.dirs[path]);
  const indent = useMemo(() => ({ paddingLeft: 16 + depth * 14 }), [depth]);
  if (!listing || listing === "loading")
    return <SkeletonRows rows={depth === 0 ? 7 : 3} indent={6 + depth * 14} />;
  if ("error" in listing)
    return (
      <T v="mono" style={[st.error, indent]}>
        {listing.error}
      </T>
    );
  if (listing.length === 0)
    return (
      <T v="label" style={[st.emptyRow, indent]}>
        empty folder
      </T>
    );
  return listing.map((e, i) => (
    <Node key={e.path} e={e} i={i} depth={depth} marks={marks} ask={ask} prompt={prompt} />
  ));
}

function iconFor(dir: boolean, open: boolean) {
  if (!dir) return File;
  return open ? FolderOpen : Folder;
}

function iconColor(dir: boolean, on: boolean) {
  if (dir) return color.cyan;
  return on ? color.cyan2 : color.muted;
}

/** Row ease-in stagger: 18ms per row, capped so long folders still land quickly. */
const enterDelay = (i: number) => web({ animationDelay: `${Math.min(i, 12) * 18}ms` });

function Node({
  e,
  i,
  depth,
  marks,
  ask,
  prompt,
}: {
  e: Entry;
  i: number;
  depth: number;
  marks: ReturnType<typeof useChangeMarks>;
  ask: Ask;
  prompt: Prompt;
}) {
  const open = useFiles((s) => !!s.expanded[e.path]);
  const { filePath, openFile } = useUi();
  const anchor = useAnchor();
  const dir = e.kind === "directory";
  const on = filePath === e.path;
  const Icon = iconFor(dir, open);
  const mark = marks[e.path];
  const onPress = useCallback(
    () => (dir ? toggleDir(e.path) : openFile(e.path)),
    [dir, e.path, openFile],
  );
  const indent = useMemo(() => ({ paddingLeft: 6 + depth * 14 }), [depth]);
  const enter = useMemo(() => [st.enter, enterDelay(i)], [i]);
  const markStyle = useMemo(() => [st.mark, { color: mark?.tint }], [mark?.tint]);
  const items = useEntryMenu(e, !!mark, ask, prompt);
  return (
    <>
      <View ref={anchor.ref} collapsable={false} style={enter}>
        <Pressable onPress={onPress} onLongPress={anchor.open}>
          {({ hovered }) => (
            <View style={[st.node, indent, hovered && st.hovered, on && st.nodeOn]}>
              <Brackets on={on} len={6} />
              {dir ? (
                <View style={[st.chev, open && st.chevOpen]}>
                  <ChevronRight size={12} color={hovered ? color.muted : color.faint} />
                </View>
              ) : (
                <View style={st.chevSpacer} />
              )}
              <Icon size={14} color={iconColor(dir, on)} strokeWidth={1.6} />
              <T numberOfLines={1} style={[st.nodeName, on && st.nodeNameOn]}>
                {e.name}
              </T>
              {hovered && (
                <Pressable
                  onPress={anchor.open}
                  hitSlop={6}
                  accessibilityLabel={`${e.name} actions`}
                >
                  <MoreHorizontal size={13} color={color.faint} />
                </Pressable>
              )}
              {mark && (
                <T v="mono" style={markStyle}>
                  {mark.letter}
                </T>
              )}
            </View>
          )}
        </Pressable>
      </View>
      <Menu rect={anchor.rect} onClose={anchor.close} items={items} width={250} />
      {dir && open && (
        <Dir path={e.path} depth={depth + 1} marks={marks} ask={ask} prompt={prompt} />
      )}
    </>
  );
}

/** The round-4 file-menu, limited to what the daemon can do. */
function useEntryMenu(e: Entry, changed: boolean, ask: Ask, prompt: Prompt): MenuEntry[] {
  const openFile = useUi((s) => s.openFile);
  const root = useFiles((s) => s.root);
  return useMemo(() => {
    const dir = e.kind === "directory";
    const abs = root ? `${root}/${e.path}` : e.path;
    const items: MenuEntry[] = [];
    if (dir)
      items.push(
        {
          label: "New file…",
          icon: FilePlus,
          onPress: () => prompt(newEntrySpec(e.path, "file", openFile)),
        },
        {
          label: "New folder…",
          icon: FolderPlus,
          onPress: () => prompt(newEntrySpec(e.path, "directory", openFile)),
        },
      );
    else items.push({ label: "Open", kbd: "↵", onPress: () => openFile(e.path) });
    items.push(
      "-",
      { label: "Copy path", onPress: () => void copyText(abs) },
      { label: "Copy relative path", onPress: () => void copyText(e.path) },
      "-",
      {
        label: "Rename…",
        kbd: "F2",
        onPress: () =>
          prompt({
            eyebrow: fileParent(e.path) === "." ? "Files" : `Files · ${fileParent(e.path)}`,
            title: `Rename ${e.name}`,
            initial: e.name,
            action: "Rename",
            run: (name) => renameEntry(e.path, name),
          }),
      },
      {
        label: "Duplicate…",
        onPress: () =>
          ask({
            title: `Duplicate ${e.name}?`,
            body: "Creates a copy beside the original.",
            action: "Duplicate",
            run: () => duplicateEntry(e.path),
          }),
      },
    );
    if (changed)
      items.push({
        label: "Discard changes…",
        danger: true,
        onPress: () =>
          ask({
            eyebrow: "Files",
            title: `Discard changes to ${e.name}?`,
            body: "Restores the file to its last committed state. This cannot be undone.",
            action: "Discard changes",
            danger: true,
            run: () => void discard([e.path]),
          }),
      });
    items.push({
      label: "Delete…",
      danger: true,
      onPress: () =>
        ask({
          eyebrow: "Files",
          title: `Delete ${e.name}?`,
          body: dir
            ? "Deletes the folder and everything in it from the checkout."
            : "Deletes the file from the checkout.",
          action: "Delete",
          danger: true,
          run: async () => {
            const error = await deleteEntry(e.path);
            if (error) return error;
            closeTabs([e.path]);
            if (useUi.getState().filePath === e.path) openFile(null);
            return null;
          },
        }),
    });
    return items;
  }, [e, changed, ask, prompt, openFile, root]);
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  flex: { flex: 1 },
  rootRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  rootName: { fontSize: 13, color: color.text, flexShrink: 1 },
  rootBranch: { fontSize: 11, color: color.faint, flexShrink: 1 },
  scrollPad: { paddingBottom: 16 },
  emptyRow: { paddingVertical: 5, color: color.faint },
  enter: anim(frames.enter, "220ms", ease),
  chev: { width: 12, height: 12, ...web({ transition: `transform 180ms ${ease}` }) },
  chevOpen: { transform: [{ rotate: "90deg" }] },
  error: { color: color.coral },
  node: {
    ...web({ transition: "background-color 120ms ease-out" }),
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
  mark: { fontSize: 10.5, width: 12, textAlign: "right" },
});
