import { ArrowUp, Maximize2, Mic, Minimize2, Plus, Scissors, Square } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { color, ease, font, web } from "../theme/tokens";
import { attachPicked, type Attachment, type SlashCommand } from "./chat/actions";
import type { Picked } from "./chat/upload";
import { AttachChips, AttachButton } from "./chat/Attach";
import { useComposerHeight } from "./chat/composerSize";
import { useDropFiles } from "./chat/dropFiles";
import { usePasteImages } from "./chat/pasteImages";
import { SlashMenu, matchCommands } from "./chat/SlashMenu";
import { toast, toastError } from "./toast/store";
import { Cut } from "./Cut";
import { Floating } from "./Floating";
import { T } from "./Text";

type SendFn = (text: string, attachments: Attachment[]) => void | Promise<void>;

export interface CutSend {
  onSend: SendFn;
  /** Why it cannot cut right now (nothing to summarise yet); null when it can. */
  blocked: string | null;
}

type KeyEvent = NativeSyntheticEvent<
  TextInputKeyPressEventData & {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
  }
>;

/** A draft set aside with Ctrl+S: it comes back after the next send. */
interface Stash {
  text: string;
  atts: Attachment[];
}

export function Composer({
  placeholder,
  chips,
  onSend,
  compact,
  onStop,
  children,
  loadCommands,
  attach,
  notices,
  initialAttachments,
  right,
  expandable,
  sizeKey,
  onTyping,
  above,
  cut,
  shellEscape,
  disabled = false,
}: {
  placeholder: string;
  chips: string[];
  onSend: (text: string, attachments: Attachment[]) => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
  onStop?: () => void;
  /** Live pickers (model, mode), drawn after the static chips. */
  children?: ReactNode;
  /** Slash commands and skills for the `/` autocomplete. */
  loadCommands?: () => Promise<SlashCommand[]>;
  /** Show the + attach menu and attachment chips. */
  attach?: boolean;
  /** Notice strips drawn above the input (stale cache, auto-resume). */
  notices?: ReactNode;
  /** Attachments already waiting (a fork's context). */
  initialAttachments?: Attachment[];
  /** Drawn at the right of the bar, before the mic (context meter). */
  right?: ReactNode;
  /** A grip and an expand toggle: the input can be dragged taller or opened as a big editor. */
  expandable?: boolean;
  /** Remembers the input's size under this key (the session id). */
  sizeKey?: string;
  /** Called when the draft goes from empty to written and back (presence "typing"). */
  onTyping?: (typing: boolean) => void;
  /** Drawn above the box, on the composer column (who else is here). */
  above?: ReactNode;
  /** A second send button (scissors) that sends the message after a clean cut. */
  cut?: CutSend;
  /** `!cmd` runs on the host (the daemon supports it): say so while one is typed. */
  shellEscape?: { cwd: string };
}) {
  const [sending, setSending] = useState(false);
  const [commandError, setCommandError] = useState(false);
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<Attachment[]>(initialAttachments ?? []);
  const [commands, setCommands] = useState<SlashCommand[] | null>(null);
  const [hi, setHi] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const [stash, setStash] = useState<Stash | null>(null);
  const empty = !text.trim() && atts.length === 0;
  const typing = !!text.trim();
  useEffect(() => onTyping?.(typing), [onTyping, typing]);
  useEffect(() => () => onTyping?.(false), [onTyping]);
  const size = useComposerHeight(sizeKey, compact ? 40 : 48);
  const { setContent, collapse } = size;
  const measure = useCallback(
    (e: LayoutChangeEvent) => setContent(e.nativeEvent.layout.height),
    [setContent],
  );
  // The mirror wraps exactly like the input; a trailing newline needs a character to take a line.
  const mirror = text.endsWith("\n") || !text ? `${text} ` : text;
  const inputBox = useMemo(() => [s.inputBox, { height: size.height }], [size.height]);

  const slashQuery = /^\/\S*$/.test(text) && !slashClosed ? text.slice(1) : null;
  useEffect(() => {
    if (slashQuery === null || commands || !loadCommands) return;
    let live = true;
    loadCommands().then(
      (items) => live && setCommands(items),
      () => {
        if (live) {
          setCommands([]);
          setCommandError(true);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [slashQuery, commands, loadCommands]);
  const matches = useMemo(
    () => (slashQuery === null || !commands ? [] : matchCommands(commands, slashQuery)),
    [commands, slashQuery],
  );
  const slashOpen = slashQuery !== null && !!loadCommands;

  const onChange = useCallback((t: string) => {
    setText(t);
    setHi(0);
    setSlashClosed(false);
  }, []);
  const pickCommand = useCallback((c: SlashCommand) => {
    setText(`/${c.name} `);
    setSlashClosed(true);
  }, []);
  const send = useCallback(
    async (via: SendFn) => {
      const t = text.trim();
      if (disabled || sending || (!t && atts.length === 0)) return;
      // Both sends (plain and clean cut) wait for uploads: a half-sent file can't ride along.
      if (atts.some((a) => a.kind === "upload")) {
        toast({ title: "Still uploading", detail: "Send once the files finish uploading." });
        return;
      }
      setSending(true);
      try {
        await via(t, atts);
        // A stashed draft comes back once the message it made way for has gone.
        setText(stash?.text ?? "");
        setAtts(stash?.atts ?? []);
        setStash(null);
        collapse();
      } catch (error) {
        toastError("Message not sent", error);
      } finally {
        setSending(false);
      }
    },
    [text, atts, disabled, sending, stash, collapse],
  );
  // Ctrl+S, as in Claude Code: set the draft aside (or swap it with the one set aside). Files
  // still uploading stay put, since their upload lands on the composer's current list.
  const toggleStash = useCallback(() => {
    const keep = atts.filter((a) => a.kind !== "upload");
    const uploading = atts.filter((a) => a.kind === "upload");
    const draft = text || keep.length ? { text, atts: keep } : null;
    if (!draft && !stash) return;
    setText(stash?.text ?? "");
    setAtts([...(stash?.atts ?? []), ...uploading]);
    setStash(draft);
    setHi(0);
    setSlashClosed(false);
  }, [text, atts, stash]);
  const submit = useCallback(() => send(onSend), [send, onSend]);
  const cutSend = cut?.onSend;
  const submitCut = useCallback(() => {
    if (cutSend) void send(cutSend);
  }, [send, cutSend]);
  // Enter sends, Shift+Enter breaks the line (hardware keyboards; mobile soft keyboards send with the button).
  const onKeyPress = useCallback(
    (e: KeyEvent) => {
      const k = e.nativeEvent.key;
      const ev = e.nativeEvent;
      if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey && k.toLowerCase() === "s") {
        e.preventDefault();
        toggleStash();
        return;
      }
      if (slashOpen && matches.length > 0) {
        if (k === "ArrowDown" || k === "ArrowUp") {
          e.preventDefault();
          const step = k === "ArrowDown" ? 1 : -1;
          setHi((h) => (h + step + matches.length) % matches.length);
          return;
        }
        if (k === "Tab" || (k === "Enter" && !e.nativeEvent.shiftKey)) {
          e.preventDefault();
          pickCommand(matches[Math.min(hi, matches.length - 1)]);
          return;
        }
      }
      if (slashOpen && k === "Escape") {
        setSlashClosed(true);
        return;
      }
      if (k === "Enter" && !e.nativeEvent.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [slashOpen, matches, hi, pickCommand, submit, toggleStash],
  );
  const addAtts = useCallback(
    (more: Attachment[]) => setAtts((a) => upsertAttachments(a, more)),
    [],
  );
  const removeAtt = useCallback((id: string) => setAtts((a) => a.filter((x) => x.id !== id)), []);
  const anchor = useRef<View>(null);
  const input = useRef<TextInput>(null);
  usePasteImages(input, addAtts, removeAtt, !!attach && !disabled);
  const box = useRef<View>(null);
  const dropped = useCallback(
    (picked: Picked[]) => attachPicked(picked, addAtts, removeAtt),
    [addAtts, removeAtt],
  );
  const dragOver = useDropFiles(box, dropped, { enabled: !!attach && !disabled });
  const highlight = Math.min(hi, Math.max(0, matches.length - 1));
  const slashMenu = useCallback(
    (p: { up: boolean; maxHeight: number }) => (
      <SlashMenu
        up={p.up}
        maxHeight={p.maxHeight}
        error={commandError}
        commands={commands}
        matches={matches}
        highlight={highlight}
        onPick={pickCommand}
      />
    ),
    [commandError, commands, matches, highlight, pickCommand],
  );
  return (
    <View style={s.wrap} ref={anchor}>
      {above}
      {slashOpen && (
        <Floating anchor={anchor} up width={340} gap={6}>
          {slashMenu}
        </Floating>
      )}
      <View ref={box} collapsable={false}>
        <Cut size={10} style={[s.box, dragOver && s.boxDrop]}>
          {notices}
          {stash && <StashNote stash={stash} />}
          {shellEscape && !atts.length && <ShellNote text={text} cwd={shellEscape.cwd} />}
          {atts.length > 0 && <AttachChips items={atts} onRemove={removeAtt} />}
          {expandable && (
            <View
              {...size.grip}
              style={s.grip}
              accessibilityRole="adjustable"
              accessibilityLabel="Drag to resize the message box"
            >
              <View style={[s.gripBar, size.dragging && s.gripOn]} />
            </View>
          )}
          <Animated.View style={inputBox}>
            <T pointerEvents="none" style={s.mirror} onLayout={measure}>
              {mirror}
            </T>
            <TextInput
              ref={input}
              editable={!sending}
              value={text}
              onChangeText={onChange}
              placeholder={placeholder}
              placeholderTextColor={color.faint}
              multiline
              style={s.input}
              onKeyPress={onKeyPress}
            />
          </Animated.View>
          <View style={s.bar}>
            {attach ? (
              <AttachButton onAdd={addAtts} onRemove={removeAtt} />
            ) : (
              <Plus size={16} color={color.muted} />
            )}
            {chips.map((c, n) => (
              <View key={c} style={s.chip}>
                {n === 0 && <View style={s.chipDot} />}
                <T v="mono" style={s.chipT}>
                  {c}
                </T>
              </View>
            ))}
            {children}
            <View style={s.spacer} />
            {right}
            {expandable && (
              <Pressable
                onPress={size.toggle}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={
                  size.expanded ? "Shrink the message box" : "Expand the message box"
                }
              >
                {({ hovered }) =>
                  size.expanded ? (
                    <Minimize2 size={14} color={hovered ? color.text : color.muted} />
                  ) : (
                    <Maximize2 size={14} color={hovered ? color.text : color.muted} />
                  )
                }
              </Pressable>
            )}
            <Mic size={16} color={color.muted} />
            <SendControls
              stop={onStop && empty ? onStop : undefined}
              idle={empty || disabled || sending}
              onSend={submit}
              cut={cut}
              onCut={submitCut}
            />
          </View>
        </Cut>
      </View>
    </View>
  );
}

/** While a `!cmd` is typed: where it runs and where its output goes. */
function ShellNote({ text, cwd }: { text: string; cwd: string }) {
  if (!/^\s*!\S/.test(text)) return null;
  return (
    <View style={s.stash}>
      <T v="mono" style={s.shellT} numberOfLines={1}>
        {`Shell command · runs in ${cwd}; the output goes to the agent with your next message`}
      </T>
    </View>
  );
}

/** Says a draft is set aside and how it comes back. */
function StashNote({ stash }: { stash: Stash }) {
  const first = stash.text.split("\n")[0].trim();
  const what = first
    ? `“${first.length > 48 ? `${first.slice(0, 48)}…` : first}”`
    : `${stash.atts.length} attachment${stash.atts.length === 1 ? "" : "s"}`;
  return (
    <View style={s.stash}>
      <T v="mono" style={s.stashT} numberOfLines={1}>
        {`Stashed ${what} · back after you send · Ctrl+S to restore now`}
      </T>
    </View>
  );
}

/** Stop while a turn runs and nothing is typed; otherwise send, with the clean-cut send beside it. */
function SendControls({
  stop,
  idle,
  onSend,
  cut,
  onCut,
}: {
  stop?: () => void;
  idle: boolean;
  onSend: () => void;
  cut?: CutSend;
  onCut: () => void;
}) {
  const sendState = useMemo(() => ({ disabled: idle }), [idle]);
  if (stop)
    return (
      <Pressable onPress={stop} accessibilityLabel="Stop">
        <Cut size={6} style={[s.send, s.stop]}>
          <Square size={11} color={color.coral} fill={color.coral} />
        </Cut>
      </Pressable>
    );
  return (
    <>
      {cut && <CutButton onPress={onCut} blocked={cut.blocked} idle={idle} />}
      <Pressable
        onPress={onSend}
        disabled={idle}
        accessibilityRole="button"
        accessibilityState={sendState}
        accessibilityLabel="Send"
      >
        <Cut size={6} style={[s.send, idle && s.idle]}>
          <ArrowUp size={16} color={color.onAccent} strokeWidth={2.2} />
        </Cut>
      </Pressable>
    </>
  );
}

/**
 * Send with a clean cut: the conversation is summarised into a fresh one first, then this message
 * goes to it. Outlined beside the filled send so the two never read as the same action; hovering
 * names what it does.
 */
function CutButton({
  onPress,
  blocked,
  idle,
}: {
  onPress: () => void;
  blocked: string | null;
  idle: boolean;
}) {
  const off = idle || !!blocked;
  const state = useMemo(() => ({ disabled: off }), [off]);
  // Not `disabled`: a disabled Pressable reports no hover, and the hover says why it is off.
  const press = useCallback(() => {
    if (!off) onPress();
  }, [off, onPress]);
  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityState={state}
      accessibilityLabel="Send with a clean cut"
      accessibilityHint={blocked ?? "Summarises the conversation into a fresh one, then sends"}
    >
      {({ hovered }) => (
        <View>
          {hovered && (
            <View style={s.tip} pointerEvents="none">
              <T v="mono" style={s.tipT} numberOfLines={1}>
                {blocked ?? "Send with a clean cut"}
              </T>
            </View>
          )}
          <Cut size={6} style={[s.cutBtn, hovered && !off && s.cutHover, off && s.idle]}>
            <Scissors size={14} color={hovered && !off ? color.text : color.cyan2} />
          </Cut>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  wrap: { position: "relative" },
  box: {
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    ...web({ transition: `border-color 140ms ${ease}, background-color 140ms ${ease}` }),
  },
  boxDrop: { borderColor: color.cyan2, backgroundColor: color.wash2 },
  stash: { marginBottom: 6 },
  stashT: { fontSize: 11, color: color.muted },
  shellT: { fontSize: 11, color: color.cyan2 },
  inputBox: { position: "relative", overflow: "hidden" },
  input: {
    flex: 1,
    padding: 0,
    color: color.text,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: "top",
    ...web({ outlineStyle: "none", resize: "none" }),
  },
  // Same type and width as the input, never seen: its height is the text's own height.
  mirror: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    ...web({ whiteSpace: "pre-wrap", overflowWrap: "break-word", visibility: "hidden" }),
  },
  grip: {
    alignSelf: "center",
    marginTop: -8,
    marginBottom: 2,
    paddingHorizontal: 18,
    paddingVertical: 4,
    ...web({ cursor: "ns-resize", touchAction: "none" }),
  },
  gripBar: {
    width: 28,
    height: 3,
    backgroundColor: color.line2,
    ...web({ transition: `background-color 160ms ${ease}, width 200ms ${ease}` }),
  },
  gripOn: { width: 40, backgroundColor: color.cyan2 },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" },
  spacer: { flex: 1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: color.wash,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipT: { color: color.text },
  chipDot: {
    width: 6,
    height: 6,
    backgroundColor: color.cyan2,
    transform: [{ rotate: "45deg" }],
  },
  stop: {
    backgroundColor: `${color.coral}24`,
    ...web({ backgroundImage: "none" }),
  },
  idle: { opacity: 0.55 },
  cutBtn: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.raise,
    ...web({ transition: `background-color 140ms ${ease}, border-color 140ms ${ease}` }),
  },
  cutHover: { backgroundColor: color.wash2, borderColor: color.cyan2 },
  tip: {
    position: "absolute",
    bottom: 36,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
    ...web({ whiteSpace: "nowrap" }),
  },
  tipT: { fontSize: 11, color: color.text },
  send: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.cyan,
    ...web({
      backgroundImage: `linear-gradient(135deg, ${color.cyan2}, ${color.cyan} 60%, ${color.deep})`,
    }),
  },
});

/** Adds attachments, replacing any with the same id (an upload chip becoming its file). */
function upsertAttachments(list: Attachment[], more: Attachment[]): Attachment[] {
  const byId = new Map(more.map((m) => [m.id, m]));
  const kept = list.map((x) => byId.get(x.id) ?? x);
  const known = new Set(list.map((x) => x.id));
  return [...kept, ...more.filter((m) => !known.has(m.id))];
}
