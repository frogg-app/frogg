import {
  Archive,
  Copy,
  GitFork,
  MoreHorizontal,
  Pencil,
  Scissors,
  Undo2,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { archiveSession, useDaemon } from "../../daemon/store";
import type { Session, TimelineEntry } from "../../daemon/types";
import { color, font, web } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { Button } from "../Button";
import { copyText } from "../shell/copy";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import { toast, toastError } from "../toast/store";
import { Dialog } from "../tools/Dialog";
import { Menu, useAnchor, type MenuEntry } from "../tools/Menu";
import { checkoutRisk, cleanCut, fork, hasFeature, renameSession, rewind } from "./actions";

type Open = null | "rename" | "archive" | "rewind";

/** The chat header ⋯: rename, fork, rewind, clean cut, copy ID, archive. */
export function SessionMenu({
  session,
  onArchived,
}: {
  session: Session;
  onArchived?: () => void;
}) {
  const a = session.agent;
  const anchor = useAnchor();
  const [open, setOpen] = useState<Open>(null);
  const close = useCallback(() => setOpen(null), []);
  const entries = useDaemon((st) => st.timelines[a.id]);
  const target = useMemo(() => lastUserMessage(entries), [entries]);
  const caps = a.capabilities;
  const canRewind =
    hasFeature("rewind") &&
    !!(caps.supportsRewindBoth || caps.supportsRewindConversation || caps.supportsRewindFiles);
  const doFork = useCallback(() => {
    fork(a).then(
      (id) => {
        toast({ title: "Forked", detail: "A new session carries this conversation" });
        return useUi.getState().select(id);
      },
      (e) => toastError("Fork failed", e),
    );
  }, [a]);
  const doCut = useCallback(() => {
    toast({ title: "Clean cut started", detail: "Summarising the conversation", kind: "info" });
    cleanCut(a.id).then(
      () => toast({ title: "Clean cut done", detail: "The next message starts from the summary" }),
      (e) => toastError("Clean cut failed", e),
    );
  }, [a.id]);
  const copyId = useCallback(() => {
    void copyText(a.id).then((ok) => ok && toast({ title: "Copied session ID", detail: a.id }));
  }, [a.id]);
  const items = useMemo<MenuEntry[]>(() => {
    const list: MenuEntry[] = [
      { label: "Rename…", icon: Pencil, onPress: () => setOpen("rename") },
    ];
    if (hasFeature("agentForkContext"))
      list.push({
        label: "Fork session",
        icon: GitFork,
        hint: "New session with this context",
        onPress: doFork,
      });
    if (canRewind)
      list.push({
        label: "Rewind…",
        icon: Undo2,
        disabled: !target || a.status === "running",
        hint: target ? undefined : "Nothing to rewind yet",
        onPress: () => setOpen("rewind"),
      });
    if (hasFeature("agentCleanCut"))
      list.push({
        label: "Clean cut",
        icon: Scissors,
        hint: "Summarise, continue in a fresh context",
        disabled: a.status === "running",
        onPress: doCut,
      });
    list.push({ label: "Copy session ID", icon: Copy, onPress: copyId });
    list.push("-", {
      label: "Archive session…",
      icon: Archive,
      danger: true,
      onPress: () => setOpen("archive"),
    });
    return list;
  }, [doFork, doCut, copyId, canRewind, target, a.status]);
  return (
    <>
      <View ref={anchor.ref} collapsable={false}>
        <Pressable onPress={anchor.open} accessibilityLabel="Session actions" hitSlop={8}>
          {({ hovered }) => <MoreHorizontal size={18} color={hovered ? color.text : color.muted} />}
        </Pressable>
      </View>
      <Menu rect={anchor.rect} onClose={anchor.close} items={items} right width={250} />
      {open === "rename" && <RenameDialog session={session} onClose={close} />}
      {open === "archive" && (
        <ArchiveDialog session={session} onClose={close} onArchived={onArchived} />
      )}
      {open === "rewind" && target && (
        <RewindDialog session={session} target={target} onClose={close} onFork={doFork} />
      )}
    </>
  );
}

interface Target {
  messageId: string;
  text: string;
  /** Timeline items after it, the user message included. */
  removes: number;
  files: number;
}

function lastUserMessage(entries: TimelineEntry[] | undefined): Target | null {
  if (!entries) return null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const it = entries[i].item;
    if (it.type === "user_message" && it.messageId) {
      const after = entries.slice(i);
      const files = new Set<string>();
      for (const e of after) {
        const t = e.item;
        if (t.type === "tool_call" && (t.detail.type === "edit" || t.detail.type === "write"))
          files.add((t.detail as { filePath?: string }).filePath ?? t.callId);
      }
      const removes = after.filter(
        (e) => e.item.type === "user_message" || e.item.type === "assistant_message",
      ).length;
      return { messageId: it.messageId, text: it.text, removes, files: files.size };
    }
  }
  return null;
}

function excerpt(t: string, n = 48): string {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

function RenameDialog({ session, onClose }: { session: Session; onClose: () => void }) {
  const [name, setName] = useState(session.agent.title ?? "");
  const [busy, setBusy] = useState(false);
  const save = useCallback(() => {
    const t = name.trim();
    if (!t) return;
    setBusy(true);
    renameSession(session.agent.id, t).then(
      () => {
        toast({ title: "Renamed", detail: t });
        return onClose();
      },
      (e) => {
        setBusy(false);
        toastError("Rename failed", e);
      },
    );
  }, [name, session.agent.id, onClose]);
  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Session"
      title="Rename session"
      width={420}
      footer={
        <>
          <Button label="Cancel" onPress={onClose} />
          <Button kind="primary" label="Rename" onPress={save} disabled={busy || !name.trim()} />
        </>
      }
    >
      <TextInput
        value={name}
        onChangeText={setName}
        autoFocus
        selectTextOnFocus
        onSubmitEditing={save}
        style={s.input}
        placeholder="Session title"
        placeholderTextColor={color.faint}
      />
    </Dialog>
  );
}

function ArchiveDialog({
  session,
  onClose,
  onArchived,
}: {
  session: Session;
  onClose: () => void;
  onArchived?: () => void;
}) {
  const a = session.agent;
  const [riskFailed, setRiskFailed] = useState(false);
  const [risk, setRisk] = useState<Awaited<ReturnType<typeof checkoutRisk>> | undefined>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    checkoutRisk(a.cwd).then(setRisk, () => {
      setRisk(null);
      setRiskFailed(true);
    });
  }, [a.cwd]);
  const go = useCallback(() => {
    setBusy(true);
    archiveSession(a.id).then(
      () => {
        toast({ title: "Archived", detail: a.title ?? undefined });
        onClose();
        return onArchived?.();
      },
      (e) => {
        setBusy(false);
        toastError("Archive failed", e);
      },
    );
  }, [a.id, a.title, onClose, onArchived]);
  const openScm = useCallback(() => {
    onClose();
    useUi.getState().setTool("scm");
  }, [onClose]);
  const unsaved = !!risk && (risk.dirty || risk.unpushed > 0);
  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Archive session"
      title={`Archive “${a.title || "Untitled session"}”?`}
      width={460}
      footer={
        <>
          <Button label="Cancel" onPress={onClose} />
          {unsaved && <Button label="Review changes first" onPress={openScm} />}
          <Button
            kind="danger"
            label={unsaved ? "Archive anyway" : "Archive"}
            onPress={go}
            disabled={busy || risk === undefined}
          />
        </>
      }
    >
      <T style={s.p}>
        The agent stops and the session leaves your lists. Files on disk stay as they are; you can
        restore from History.
      </T>
      {riskFailed && (
        <T style={s.mut}>Could not check for unsaved work. Review the checkout before archiving.</T>
      )}
      {risk === undefined && <T v="label">checking for unsaved work…</T>}
      {unsaved && (
        <View style={s.warn}>
          <T style={s.warnHead}>Not saved anywhere else</T>
          {risk.dirty && (
            <View style={s.ck}>
              <StatusGlyph bucket="needs" size={7} still />
              <T style={s.ckT}>Uncommitted changes</T>
            </View>
          )}
          {risk.unpushed > 0 && (
            <View style={s.ck}>
              <StatusGlyph bucket="needs" size={7} still />
              <T style={s.ckT}>
                {risk.unpushed} unpushed commit{risk.unpushed === 1 ? "" : "s"}
                {risk.branch ? ` on ${risk.branch}` : ""}
              </T>
            </View>
          )}
        </View>
      )}
    </Dialog>
  );
}

type Mode = "both" | "conversation" | "files";
const MODES: Array<{ id: Mode; label: string }> = [
  { id: "both", label: "Conversation and files" },
  { id: "conversation", label: "Conversation only" },
  { id: "files", label: "Files only" },
];

function RewindDialog({
  session,
  target,
  onClose,
  onFork,
}: {
  session: Session;
  target: Target;
  onClose: () => void;
  onFork: () => void;
}) {
  const caps = session.agent.capabilities;
  const allowed = useMemo(
    () =>
      MODES.filter((m) => {
        if (m.id === "both") return caps.supportsRewindBoth;
        if (m.id === "conversation") return caps.supportsRewindConversation;
        return caps.supportsRewindFiles;
      }),
    [caps],
  );
  const [mode, setMode] = useState<Mode>(allowed[0]?.id ?? "conversation");
  const [busy, setBusy] = useState(false);
  const go = useCallback(() => {
    setBusy(true);
    rewind(session.agent.id, target.messageId, mode).then(
      () => {
        toast({ title: "Rewound", detail: excerpt(target.text) });
        return onClose();
      },
      (e) => {
        setBusy(false);
        toastError("Rewind failed", e);
      },
    );
  }, [session.agent.id, target, mode, onClose]);
  const forkInstead = useCallback(() => {
    onClose();
    onFork();
  }, [onClose, onFork]);
  const parts = [];
  if (mode !== "files")
    parts.push(`removes ${target.removes} message${target.removes === 1 ? "" : "s"}`);
  if (mode !== "conversation" && target.files)
    parts.push(`reverts ${target.files} file${target.files === 1 ? "" : "s"}`);
  const summary = parts.length ? `${parts.join(" and ")}. ` : "";
  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Rewind"
      title={`Rewind to “${excerpt(target.text)}”?`}
      width={460}
      footer={
        <>
          {hasFeature("agentForkContext") && <Button label="Fork instead" onPress={forkInstead} />}
          <Button kind="danger" label="Rewind" onPress={go} disabled={busy} />
        </>
      }
    >
      <View style={s.choices}>
        {allowed.map((m) => (
          <Choice key={m.id} id={m.id} label={m.label} on={mode === m.id} onPick={setMode} />
        ))}
      </View>
      <T style={s.mut}>
        {summary.charAt(0).toUpperCase() + summary.slice(1)}This cannot be undone; fork first if
        unsure.
      </T>
    </Dialog>
  );
}

function Choice({
  id,
  label,
  on,
  onPick,
}: {
  id: Mode;
  label: string;
  on: boolean;
  onPick: (m: Mode) => void;
}) {
  const checkedState = useMemo(() => ({ checked: on }), [on]);
  const press = useCallback(() => onPick(id), [id, onPick]);
  return (
    <Pressable onPress={press} accessibilityRole="radio" accessibilityState={checkedState}>
      {({ hovered }) => (
        <View style={[s.choice, hovered && s.choiceH, on && s.choiceOn]}>
          <View style={[s.radio, on && s.radioOn]} />
          <T style={s.choiceT}>{label}</T>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.bg,
    color: color.text,
    fontFamily: font.body,
    fontSize: 14,
    paddingHorizontal: 10,
    paddingVertical: 9,
    ...web({ outlineStyle: "none" }),
  },
  p: { color: color.muted, lineHeight: 21 },
  mut: { color: color.muted, lineHeight: 20, fontSize: 12.5 },
  warn: {
    borderWidth: 1,
    borderColor: `${color.amber}59`,
    backgroundColor: `${color.amber}0f`,
    padding: 12,
    gap: 8,
  },
  warnHead: { fontWeight: "600", fontSize: 12.5 },
  ck: { flexDirection: "row", alignItems: "center", gap: 10 },
  ckT: { fontSize: 13 },
  choices: { gap: 4 },
  choice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: color.wash,
  },
  choiceH: { borderColor: color.line },
  choiceOn: { borderColor: `${color.cyan}80`, backgroundColor: `${color.cyan}14` },
  radio: {
    width: 8,
    height: 8,
    borderWidth: 1,
    borderColor: color.muted,
    transform: [{ rotate: "45deg" }],
  },
  radioOn: { backgroundColor: color.cyan2, borderColor: color.cyan2 },
  choiceT: { fontSize: 13.5 },
});
