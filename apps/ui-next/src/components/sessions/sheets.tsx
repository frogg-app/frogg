import { Check, Folder, RotateCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useDaemon } from "../../daemon/store";
import { color, font, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { ago } from "../../util";
import { Button } from "../Button";
import { Toggle } from "../settings/controls";
import { T } from "../Text";
import { Dialog } from "../tools/Dialog";
import {
  addProject,
  archiveSession,
  closeSheet,
  fetchImportable,
  importSession,
  listDir,
  loadDirectory,
  makeDir,
  parentDir,
  renameSession,
  setSessionLabel,
  useDirectory,
  type LabelDef,
  type RecentProviderSession,
} from "./directory";
import { labelFill, labelHue } from "./labels";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Renders whichever session-list dialog is open. Mount once, next to the list. */
export function SessionSheets() {
  const sheet = useDirectory((d) => d.sheet);
  if (!sheet || sheet.kind === "menu") return null;
  switch (sheet.kind) {
    case "labels":
      return <LabelsDialog agentId={sheet.agentId} />;
    case "rename":
      return <RenameDialog agentId={sheet.agentId} />;
    case "archive":
      return <ArchiveDialog agentId={sheet.agentId} />;
    case "import":
      return <ImportDialog />;
    case "add-project":
      return <AddProjectDialog />;
    default:
      return null;
  }
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <T v="mono" style={s.err}>
      {text}
    </T>
  );
}

// ---- labels ----

function LabelsDialog({ agentId }: { agentId: string }) {
  const sess = useDaemon((st) => st.sessions[agentId]);
  const host = useDaemon((st) => st.serverName) ?? "";
  const workspaces = useDirectory((d) => d.workspaces);
  const labels = useDirectory((d) => d.labels);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const wsId = sess?.agent.workspaceId ?? null;
  const assigned = useMemo(
    () => new Set((wsId && workspaces[wsId]?.labels) || []),
    [wsId, workspaces],
  );
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of Object.values(workspaces))
      for (const l of w.labels ?? []) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  }, [workspaces]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? labels.filter((l) => l.name.toLowerCase().includes(needle)) : labels;
  const canCreate = needle.length > 0 && !labels.some((l) => l.name.toLowerCase() === needle);
  const toggle = useCallback(
    (label: LabelDef, on: boolean) => {
      if (!wsId) return;
      setErr(null);
      setSessionLabel(wsId, label, on).catch((e: unknown) => setErr(errText(e)));
    },
    [wsId],
  );
  const create = useCallback(() => {
    toggle({ name: q.trim(), color: "sky" }, true);
    setQ("");
  }, [q, toggle]);
  const footer = useMemo(
    () => (
      <View style={s.footRow}>
        <View style={s.flex} />
        <Button kind="primary" label="Done" onPress={closeSheet} />
      </View>
    ),
    [],
  );
  return (
    <Dialog
      open
      onClose={closeSheet}
      eyebrow={host ? `Session labels · ${host}` : "Session labels"}
      title="Labels"
      footer={footer}
      width={440}
    >
      {!wsId && <T style={s.muted}>This session has no workspace, so it cannot carry labels.</T>}
      <TextInput
        value={q}
        onChangeText={setQ}
        onSubmitEditing={canCreate ? create : undefined}
        placeholder="Search or create a label"
        placeholderTextColor={color.faint}
        style={s.input}
      />
      <View>
        {shown.map((l) => (
          <LabelRow
            key={l.name}
            label={l}
            on={assigned.has(l.name)}
            count={counts.get(l.name) ?? 0}
            onToggle={toggle}
          />
        ))}
        {canCreate && (
          <Pressable onPress={create} style={s.labelRow}>
            <T style={s.muted}>Create label “{q.trim()}”</T>
          </Pressable>
        )}
        {!shown.length && !canCreate && <T style={s.muted}>No labels yet. Type to create one.</T>}
      </View>
      <ErrorLine text={err} />
    </Dialog>
  );
}

export function LabelChip({ name, c }: { name: string; c?: LabelDef["color"] }) {
  const style = useMemo(() => [s.chip, { backgroundColor: labelFill(c) }], [c]);
  const text = useMemo(() => [s.chipT, { color: labelHue(c) }], [c]);
  return (
    <View style={style}>
      <T v="mono" style={text} numberOfLines={1}>
        {name}
      </T>
    </View>
  );
}

function LabelRow({
  label,
  on,
  count,
  onToggle,
}: {
  label: LabelDef;
  on: boolean;
  count: number;
  onToggle: (l: LabelDef, on: boolean) => void;
}) {
  const press = useCallback(() => onToggle(label, !on), [label, on, onToggle]);
  return (
    <Pressable onPress={press} accessibilityRole="checkbox">
      {({ hovered }) => (
        <View style={[s.labelRow, (on || hovered) && s.labelRowOn]}>
          <LabelChip name={label.name} c={label.color} />
          <T style={s.muted}>{count === 1 ? "1 session" : `${count} sessions`}</T>
          {on && <Check size={12} color={color.muted} />}
        </View>
      )}
    </Pressable>
  );
}

// ---- rename / archive ----

function RenameDialog({ agentId }: { agentId: string }) {
  const title = useDaemon((st) => st.sessions[agentId]?.agent.title ?? "");
  const [name, setName] = useState(title);
  const [err, setErr] = useState<string | null>(null);
  const save = useCallback(() => {
    if (!name.trim()) return;
    renameSession(agentId, name.trim())
      .then(closeSheet)
      .catch((e: unknown) => setErr(errText(e)));
  }, [agentId, name]);
  const footer = useMemo(
    () => (
      <>
        <Button label="Cancel" onPress={closeSheet} />
        <Button kind="primary" label="Rename" onPress={save} disabled={!name.trim()} />
      </>
    ),
    [save, name],
  );
  return (
    <Dialog open onClose={closeSheet} eyebrow="Session" title="Rename session" footer={footer}>
      <TextInput
        value={name}
        onChangeText={setName}
        onSubmitEditing={save}
        autoFocus
        style={s.input}
        placeholderTextColor={color.faint}
        placeholder="Session title"
      />
      <ErrorLine text={err} />
    </Dialog>
  );
}

function ArchiveDialog({ agentId }: { agentId: string }) {
  const title = useDaemon((st) => st.sessions[agentId]?.agent.title) || "this session";
  const [err, setErr] = useState<string | null>(null);
  const go = useCallback(() => {
    if (useUi.getState().selected === agentId) useUi.getState().select(null);
    archiveSession(agentId)
      .then(closeSheet)
      .catch((e: unknown) => setErr(errText(e)));
  }, [agentId]);
  const footer = useMemo(
    () => (
      <>
        <Button label="Cancel" onPress={closeSheet} />
        <Button kind="danger" label="Archive" onPress={go} />
      </>
    ),
    [go],
  );
  return (
    <Dialog open onClose={closeSheet} eyebrow="Session" title={`Archive ${title}?`} footer={footer}>
      <T style={s.muted}>
        The agent stops and the session moves to History. You can restore it from there.
      </T>
      <ErrorLine text={err} />
    </Dialog>
  );
}

// ---- import ----

function ImportDialog() {
  const host = useDaemon((st) => st.serverName) ?? "this host";
  const [rows, setRows] = useState<RecentProviderSession[] | null>(null);
  const [hiddenN, setHiddenN] = useState(0);
  const [provider, setProvider] = useState<string>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    setRows(null);
    setErr(null);
    fetchImportable()
      .then((r) => {
        setRows(r.entries);
        setHiddenN(r.hidden);
        return undefined;
      })
      .catch((e: unknown) => {
        setRows([]);
        setErr(errText(e));
      });
  }, []);
  useEffect(load, [load]);
  const providers = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows ?? []) m.set(r.providerId, r.providerLabel);
    return [...m];
  }, [rows]);
  const shown = useMemo(
    () => (rows ?? []).filter((r) => provider === "all" || r.providerId === provider),
    [rows, provider],
  );
  const flip = useCallback((id: string) => {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    let last: string | null = null;
    try {
      for (const r of rows ?? []) if (picked.has(r.providerHandleId)) last = await importSession(r);
      closeSheet();
      if (last) useUi.getState().select(last);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }, [rows, picked]);
  const importNow = useCallback(() => void run(), [run]);
  const footer = useMemo(
    () => (
      <View style={s.footRow}>
        <T style={s.footNote}>Provider sessions stay resumable.</T>
        <Button label="Cancel" onPress={closeSheet} />
        <Button
          kind="primary"
          label={busy ? "Importing…" : `Import ${picked.size || ""}`.trim()}
          onPress={importNow}
          disabled={!picked.size || busy}
        />
      </View>
    ),
    [busy, picked.size, importNow],
  );
  return (
    <Dialog
      open
      onClose={closeSheet}
      eyebrow="Sessions"
      title="Import conversations"
      footer={footer}
      width={740}
    >
      <View style={s.tabsRow}>
        <View style={s.tabs}>
          <ProviderTab
            id="all"
            label={`From ${host}`}
            on={provider === "all"}
            onPick={setProvider}
          />
          {providers.map(([id, label]) => (
            <ProviderTab key={id} id={id} label={label} on={provider === id} onPick={setProvider} />
          ))}
        </View>
        <Pressable onPress={load} style={s.refresh} accessibilityLabel="Refresh">
          <RotateCw size={12} color={color.muted} />
          <T style={s.refreshT}>Refresh</T>
        </Pressable>
      </View>
      {rows === null && <ActivityIndicator color={color.cyan} />}
      {rows !== null && !shown.length && !err && (
        <T style={s.muted}>No conversations on {host} that are not already in Frogg.</T>
      )}
      <View>
        {shown.map((r) => (
          <ImportRow
            key={r.providerHandleId}
            row={r}
            on={picked.has(r.providerHandleId)}
            onFlip={flip}
          />
        ))}
      </View>
      {hiddenN > 0 && (
        <T style={s.muted}>
          Already imported: {hiddenN} conversation{hiddenN === 1 ? " is" : "s are"} hidden.
        </T>
      )}
      <ErrorLine text={err} />
    </Dialog>
  );
}

function ProviderTab({
  id,
  label,
  on,
  onPick,
}: {
  id: string;
  label: string;
  on: boolean;
  onPick: (id: string) => void;
}) {
  const press = useCallback(() => onPick(id), [id, onPick]);
  return (
    <Pressable onPress={press} style={[s.tab, on && s.tabOn]}>
      <T style={on ? s.tabTOn : s.tabT}>{label}</T>
    </Pressable>
  );
}

const tilde = (p: string) => p.replace(/^\/(home|Users)\/[^/]+/, "~");

function ImportRow({
  row,
  on,
  onFlip,
}: {
  row: RecentProviderSession;
  on: boolean;
  onFlip: (id: string) => void;
}) {
  const flip = useCallback(() => onFlip(row.providerHandleId), [row.providerHandleId, onFlip]);
  const title = row.title || row.firstPromptPreview || "untitled";
  return (
    <Pressable onPress={flip} style={s.importRow}>
      <Toggle value={on} onChange={flip} />
      <View style={s.flex}>
        <T numberOfLines={1} style={s.rowTitle}>
          {title}
        </T>
        <T numberOfLines={1} style={s.rowMeta}>
          {row.providerLabel} · {tilde(row.cwd)} · {ago(row.lastActivityAt)} ago
        </T>
      </View>
    </Pressable>
  );
}

// ---- add project ----

function AddProjectDialog() {
  const host = useDaemon((st) => st.serverName) ?? "host";
  const [picked, setPicked] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const add = useCallback(() => {
    if (!picked) return;
    addProject(picked)
      .then(() => {
        closeSheet();
        void loadDirectory();
        return undefined;
      })
      .catch((e: unknown) => setErr(errText(e)));
  }, [picked]);
  const pickedName = picked?.split("/").pop();
  const footer = useMemo(
    () => (
      <View style={s.footRow}>
        <T style={s.footNote}>Host: {host}</T>
        <Button label="Cancel" onPress={closeSheet} />
        <Button
          kind="primary"
          label={pickedName ? `Add ${pickedName}` : "Add project"}
          onPress={add}
          disabled={!picked}
        />
      </View>
    ),
    [host, pickedName, add, picked],
  );
  return (
    <Dialog
      open
      onClose={closeSheet}
      eyebrow="Projects"
      title="Add a project"
      footer={footer}
      width={740}
    >
      <FolderBrowser picked={picked} onPick={setPicked} />
      <ErrorLine text={err} />
    </Dialog>
  );
}

/**
 * Browses folders on the connected host. A tap selects a folder (reported through onPick);
 * tapping the selected one, or a folder that is already a project, opens it.
 */
export function FolderBrowser({
  picked,
  onPick,
  from,
}: {
  picked: string | null;
  onPick: (path: string | null) => void;
  /** A folder to start beside (its parent is listed); defaults to the first project's. */
  from?: string;
}) {
  const host = useDaemon((st) => st.serverName) ?? "host";
  const projects = useDirectory((d) => d.projects);
  const start = useMemo(() => {
    const seed = from ?? projects[0]?.projectRootPath;
    return seed ? parentDir(seed) : "/";
  }, [from, projects]);
  const [dir, setDir] = useState(start);
  const [entries, setEntries] = useState<Array<{ name: string; path: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const added = useMemo(() => new Set(projects.map((p) => p.projectRootPath)), [projects]);
  const load = useCallback(
    (d: string) => {
      setEntries(null);
      setErr(null);
      onPick(null);
      listDir(d)
        .then(setEntries)
        .catch((e: unknown) => {
          setEntries([]);
          setErr(errText(e));
        });
    },
    [onPick],
  );
  useEffect(() => load(dir), [dir, load]);
  const up = useCallback(() => setDir((d) => parentDir(d)), []);
  const refresh = useCallback(() => load(dir), [dir, load]);
  const startNew = useCallback(() => setNewName(""), []);
  const createDir = useCallback(() => {
    const n = newName?.trim();
    if (!n) return;
    makeDir(dir, n)
      .then(() => {
        setNewName(null);
        load(dir);
        return undefined;
      })
      .catch((e: unknown) => setErr(errText(e)));
  }, [dir, newName, load]);
  return (
    <View style={s.browser}>
      <View style={s.pathRow}>
        <Folder size={13} color={color.muted} />
        <T v="mono" style={s.path} numberOfLines={1} ellipsizeMode="head">
          {host}:{tilde(dir)}
        </T>
        <Pressable onPress={up}>
          <T style={s.link}>Up</T>
        </Pressable>
        <Pressable onPress={refresh} accessibilityLabel="Refresh">
          <RotateCw size={12} color={color.muted} />
        </Pressable>
        <Pressable onPress={startNew}>
          <T style={s.link}>New folder</T>
        </Pressable>
      </View>
      {newName !== null && (
        <TextInput
          value={newName}
          onChangeText={setNewName}
          onSubmitEditing={createDir}
          autoFocus
          placeholder="Folder name, then Enter"
          placeholderTextColor={color.faint}
          style={s.input}
        />
      )}
      {entries === null && <ActivityIndicator color={color.cyan} />}
      <View>
        {(entries ?? []).map((e) => (
          <DirRow
            key={e.path}
            entry={e}
            added={added.has(e.path)}
            on={picked === e.path}
            onPick={onPick}
            onOpen={setDir}
          />
        ))}
      </View>
      <ErrorLine text={err} />
    </View>
  );
}

function DirRow({
  entry,
  added,
  on,
  onPick,
  onOpen,
}: {
  entry: { name: string; path: string };
  added: boolean;
  on: boolean;
  onPick: (p: string) => void;
  onOpen: (p: string) => void;
}) {
  // A tap selects; tapping the selected folder (or any added one) opens it.
  const press = useCallback(() => {
    if (on || added) onOpen(entry.path);
    else onPick(entry.path);
  }, [on, added, entry.path, onPick, onOpen]);
  return (
    <Pressable onPress={press}>
      {({ hovered }) => (
        <View style={[s.dirRow, (on || hovered) && s.dirRowOn]}>
          <Folder size={13} color={color.faint} />
          <View style={s.flex}>
            <T style={s.rowTitle}>{entry.name}</T>
            {added && <T style={s.rowMeta}>already added</T>}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  muted: { fontSize: 12.5, color: color.muted },
  err: { color: color.coral, fontSize: 11 },
  input: {
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.bg2,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    paddingHorizontal: 11,
    paddingVertical: 7,
    ...web({ outlineStyle: "none" }),
  },
  footRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  footNote: { flex: 1, fontSize: 11.5, color: color.faint },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  labelRowOn: { backgroundColor: "rgba(37,181,200,0.1)" },
  chip: { paddingHorizontal: 6, paddingVertical: 1, alignSelf: "flex-start" },
  chipT: { fontSize: 10.5 },
  tabsRow: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" },
  tabs: { flexDirection: "row", borderWidth: 1, borderColor: color.line, flexWrap: "wrap" },
  tab: { paddingHorizontal: 10, paddingVertical: 5 },
  tabOn: { backgroundColor: color.raise },
  tabT: { fontSize: 12.5, color: color.faint },
  tabTOn: { fontSize: 12.5, color: color.text },
  refresh: { flexDirection: "row", alignItems: "center", gap: 6 },
  refreshT: { fontSize: 12, color: color.muted },
  importRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowTitle: { fontSize: 13 },
  rowMeta: { fontSize: 11.5, color: color.faint, marginTop: 2 },
  browser: { gap: 10 },
  pathRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  path: { flex: 1, color: color.text, fontSize: 12.5 },
  link: { fontSize: 12, color: color.muted },
  dirRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dirRowOn: { backgroundColor: "rgba(37,181,200,0.1)" },
});
