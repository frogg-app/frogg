import { File, FilePlus, FolderPlus, MoreHorizontal, Plus, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { addTab, closeTabs, fileParent, useFileTabs, useFiles } from "../../daemon/files";

import { color, font, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { Button } from "../Button";
import { CodeBlock } from "../Code";

import { Seg } from "../settings/controls";
import { T } from "../Text";
import { copyText } from "./clipboard";
import { useConfirm } from "./Confirm";
import { Menu, useAnchor, type MenuEntry } from "./Menu";
import { usePrompt } from "./Prompt";

import { newEntrySpec } from "./fileActions";
import { hasFileDraft, useFileDocument } from "./useFileDocument";
// ---- Viewer -----------------------------------------------------------------------------------

type Mode = "source" | "edit";
const MODES: Array<[Mode, string]> = [
  ["source", "Source"],
  ["edit", "Edit"],
];

export function FileViewer(props: { path: string; onBack?: () => void }) {
  const root = useFiles((s) => s.root);
  return <FileEditor key={`${root}:${props.path}`} {...props} />;
}

function FileEditor({ path, onBack }: { path: string; onBack?: () => void }) {
  const [mode, setMode] = useState<Mode>("source");
  const { doc, draft, dirty, edit, revert, save, saving, saveError, reload } =
    useFileDocument(path);
  const menu = useAnchor();
  const confirm = useConfirm();
  const discardDraft = useCallback(
    () =>
      confirm.ask({
        title: "Discard unsaved edits?",
        body: "Your edits to this file will be removed from the editor.",
        action: "Discard edits",
        danger: true,
        run: revert,
      }),
    [confirm, revert],
  );
  const items = useMemo<MenuEntry[]>(
    () => [
      { label: "Copy relative path", onPress: () => void copyText(path) },
      { label: "Reload from disk", disabled: dirty || saving, onPress: reload },
      {
        label: "Discard unsaved edits…",
        disabled: !dirty || saving,
        danger: true,
        onPress: discardDraft,
      },
    ],
    [path, dirty, saving, reload, discardDraft],
  );
  useEffect(() => {
    addTab(path);
    setMode("source");
  }, [path]);
  const text = doc && "text" in doc ? doc.text : null;
  const name = path.split("/").pop() ?? path;
  const crumbs = path.split("/").slice(0, -1);
  return (
    <View style={st.fill}>
      <FileTabs active={path} dirty={dirty} />
      {confirm.dialog}
      <View style={st.viewerHead}>
        <View style={st.flex}>
          <T v="mono" numberOfLines={1} style={st.crumbs}>
            {crumbs.length ? `${crumbs.join(" / ")} / ` : ""}
            <T v="mono" style={st.crumbLast}>
              {name}
            </T>
          </T>
          <View style={st.titleRow}>
            {onBack && (
              <Pressable onPress={onBack} accessibilityLabel="Back">
                <T style={st.back}>←</T>
              </Pressable>
            )}
            <T v="display" style={st.title} numberOfLines={1}>
              {name}
            </T>
            {doc && "size" in doc && (
              <T v="mono" style={st.size}>
                {(doc.size / 1024).toFixed(1)} KB
              </T>
            )}
          </View>
        </View>
        {text !== null && <Seg options={MODES} value={mode} onChange={setMode} />}
        {dirty && <Button label="Revert" onPress={discardDraft} disabled={saving} />}
        {mode === "edit" && (
          <Button
            kind="primary"
            label={saving ? "Saving…" : "Save"}
            onPress={save}
            disabled={!dirty || saving}
          />
        )}
      </View>
      <View ref={menu.ref} collapsable={false}>
        <Button label="Editor actions" onPress={menu.open} />
      </View>
      <Menu rect={menu.rect} onClose={menu.close} items={items} right width={240} />
      {saveError && (
        <T v="mono" style={st.saveError}>
          {saveError}
        </T>
      )}
      <ScrollView style={st.flex} contentContainerStyle={st.viewerScroll}>
        <DocumentBody doc={doc} text={text} mode={mode} draft={draft} name={name} edit={edit} />
      </ScrollView>
      <View style={st.statusBar}>
        <T v="mono" style={[st.modeChip, mode === "edit" && st.modeChipEdit]}>
          {mode === "edit" ? "EDIT" : "VIEW"}
        </T>
        <T v="mono" style={st.statusText}>
          {text !== null ? `${text.split("\n").length} lines` : ""}
        </T>
        <View style={st.flex} />
        {dirty && (
          <T v="mono" style={st.unsaved}>
            ◆ Unsaved · save or revert before closing
          </T>
        )}
      </View>
    </View>
  );
}

function DocumentBody({
  doc,
  text,
  mode,
  draft,
  name,
  edit,
}: {
  doc: ReturnType<typeof useFileDocument>["doc"];
  text: string | null;
  mode: Mode;
  draft: string | null;
  name: string;
  edit: (text: string) => void;
}) {
  return (
    <>
      {" "}
      {!doc && (
        <T v="label" style={st.pad}>
          loading…
        </T>
      )}
      {doc && "error" in doc && (
        <T v="mono" style={st.viewerError}>
          {doc.error}
        </T>
      )}
      {doc && "kind" in doc && doc.text === null && (
        <T v="label" style={st.pad}>
          {doc.kind} file · no preview
        </T>
      )}
      {text !== null && mode === "source" && <CodeBlock code={draft ?? text} filename={name} />}
      {text !== null && mode === "edit" && (
        <TextInput
          value={draft ?? text}
          onChangeText={edit}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={st.editor}
        />
      )}
    </>
  );
}

function FileTabs({ active, dirty }: { active: string; dirty: boolean }) {
  const tabs = useFileTabs((s) => s.tabs);
  const anchor = useAnchor();
  const openFile = useUi((s) => s.openFile);
  const prompt = usePrompt();
  const items = useMemo<MenuEntry[]>(
    () => [
      {
        label: "New file…",
        icon: FilePlus,
        onPress: () => prompt.ask(newEntrySpec(fileParent(active), "file", openFile)),
      },
      {
        label: "New folder…",
        icon: FolderPlus,
        onPress: () => prompt.ask(newEntrySpec(fileParent(active), "directory", openFile)),
      },
    ],
    [prompt, active, openFile],
  );
  return (
    <View style={st.tabs}>
      <ScrollView horizontal style={st.flex} contentContainerStyle={st.tabsIn}>
        {tabs.map((p) => (
          <FileTab key={p} path={p} tabs={tabs} on={p === active} dirty={p === active && dirty} />
        ))}
      </ScrollView>
      <View ref={anchor.ref} collapsable={false}>
        <Pressable onPress={anchor.open} style={st.tabPlus} accessibilityLabel="New tab">
          <Plus size={13} color={color.faint} />
        </Pressable>
      </View>
      <Menu rect={anchor.rect} onClose={anchor.close} items={items} right width={220} />
      {prompt.dialog}
    </View>
  );
}

function FileTab({
  path,
  tabs,
  on,
  dirty,
}: {
  path: string;
  tabs: string[];
  on: boolean;
  dirty: boolean;
}) {
  const openFile = useUi((s) => s.openFile);
  const root = useFiles((s) => s.root);
  const anchor = useAnchor();
  const select = useCallback(() => openFile(path), [openFile, path]);
  const close = useCallback(
    () => closeAndPick([path], path, tabs, on, openFile),
    [path, tabs, on, openFile],
  );
  const unsaved = hasFileDraft(path);
  const items = useMemo<MenuEntry[]>(() => {
    const idx = tabs.indexOf(path);
    return [
      { label: "Copy path", onPress: () => void copyText(root ? `${root}/${path}` : path) },
      { label: "Copy relative path", onPress: () => void copyText(path) },
      "-",
      { label: "Close", kbd: "⌘W", disabled: unsaved, onPress: close },
      {
        label: "Close others",
        disabled: tabs.length < 2 || tabs.some(hasFileDraft),
        onPress: () => {
          closeTabs(tabs.filter((p) => p !== path));
          openFile(path);
        },
      },
      {
        label: "Close tabs to the right",
        disabled: idx === tabs.length - 1 || tabs.some(hasFileDraft),
        onPress: () => {
          const right = tabs.slice(idx + 1);
          closeTabs(right);
          if (!on) openFile(path);
        },
      },
    ];
  }, [tabs, path, root, close, on, openFile, unsaved]);
  const name = path.split("/").pop();
  return (
    <View ref={anchor.ref} collapsable={false}>
      <Pressable onPress={select} onLongPress={anchor.open}>
        {({ hovered }) => (
          <View style={[st.tab, on && st.tabOn, hovered && !on && st.hovered]}>
            <File size={12} color={on ? color.cyan2 : color.faint} />
            <T numberOfLines={1} style={[st.tabName, on && st.tabNameOn]}>
              {name}
            </T>
            {dirty && <View style={st.dirtyDot} />}
            {(hovered || on) && (
              <Pressable
                onPress={anchor.open}
                hitSlop={4}
                accessibilityLabel={`${name} tab actions`}
              >
                <MoreHorizontal size={12} color={color.faint} />
              </Pressable>
            )}
            <Pressable
              onPress={close}
              disabled={unsaved}
              hitSlop={4}
              accessibilityLabel={`Close ${name}`}
            >
              <X size={12} color={color.faint} />
            </Pressable>
          </View>
        )}
      </Pressable>
      <Menu rect={anchor.rect} onClose={anchor.close} items={items} width={230} />
    </View>
  );
}

function closeAndPick(
  closing: string[],
  path: string,
  tabs: string[],
  on: boolean,
  openFile: (p: string | null) => void,
) {
  const rest = tabs.filter((p) => !closing.includes(p));
  if (closing.some(hasFileDraft)) return;
  closeTabs(closing);
  if (!on) return;
  const idx = tabs.indexOf(path);
  openFile(rest[Math.min(idx, rest.length - 1)] ?? null);
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  flex: { flex: 1 },
  hovered: { backgroundColor: color.wash },
  tabs: {
    flexDirection: "row",
    alignItems: "stretch",
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    backgroundColor: color.bg,
  },
  tabsIn: { alignItems: "stretch" },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRightWidth: 1,
    borderRightColor: color.line,
    maxWidth: 240,
  },
  tabOn: { backgroundColor: color.bg2, borderTopWidth: 2, borderTopColor: color.cyan },
  tabName: { fontSize: 12.5, color: color.muted, flexShrink: 1 },
  tabNameOn: { color: color.text },
  dirtyDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.amber },
  tabPlus: { paddingHorizontal: 12, height: "100%", justifyContent: "center" },
  viewerHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  crumbs: { fontSize: 11, color: color.faint },
  crumbLast: { fontSize: 11, color: color.muted },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  back: { color: color.cyan2, fontSize: 18 },
  title: { fontSize: 19, flexShrink: 1 },
  size: { marginLeft: 8 },
  pad: { padding: 24 },
  viewerScroll: { flexGrow: 1 },
  viewerError: { color: color.coral, padding: 24 },
  saveError: { color: color.coral, paddingHorizontal: 24, paddingVertical: 6 },
  editor: {
    flex: 1,
    minHeight: 400,
    padding: 16,
    paddingHorizontal: 24,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12.5,
    lineHeight: 21,
    textAlignVertical: "top",
    ...web({ outlineStyle: "none", whiteSpace: "pre", resize: "none" }),
  },
  statusBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  modeChip: {
    fontSize: 10,
    paddingHorizontal: 6,
    backgroundColor: color.raise,
    color: color.muted,
  },
  modeChipEdit: { backgroundColor: color.cyan, color: color.onAccent },
  statusText: { fontSize: 10.5 },
  unsaved: { fontSize: 10.5, color: color.amber },
});
