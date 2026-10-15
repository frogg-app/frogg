import { ArrowUp, Maximize2, Mic, Minimize2, Plus, Square } from "lucide-react-native";
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
import type { Attachment, SlashCommand } from "./chat/actions";
import { AttachChips, AttachMenu } from "./chat/Attach";
import { useComposerHeight } from "./chat/composerSize";
import { usePasteImages } from "./chat/pasteImages";
import { SlashMenu, matchCommands } from "./chat/SlashMenu";
import { toastError } from "./toast/store";
import { Cut } from "./Cut";
import { Floating } from "./Floating";
import { T } from "./Text";

type KeyEvent = NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean }>;

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
}) {
  const [sending, setSending] = useState(false);
  const [commandError, setCommandError] = useState(false);
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<Attachment[]>(initialAttachments ?? []);
  const [commands, setCommands] = useState<SlashCommand[] | null>(null);
  const [hi, setHi] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const empty = !text.trim() && atts.length === 0;
  const typing = !!text.trim();
  useEffect(() => onTyping?.(typing), [onTyping, typing]);
  useEffect(() => () => onTyping?.(false), [onTyping]);
  const size = useComposerHeight(sizeKey, compact ? 40 : 48);
  const { setContent } = size;
  const measure = useCallback(
    (e: LayoutChangeEvent) => setContent(e.nativeEvent.layout.height),
    [setContent],
  );
  // The mirror wraps exactly like the input; a trailing newline needs a character to take a line.
  const mirror = text.endsWith("\n") || !text ? `${text} ` : text;
  const inputBox = useMemo(() => [s.inputBox, { height: size.height }], [size.height]);
  const sendState = useMemo(
    () => ({ disabled: disabled || sending || empty }),
    [disabled, sending, empty],
  );

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
  const submit = useCallback(async () => {
    const t = text.trim();
    if (disabled || sending || (!t && atts.length === 0)) return;
    setSending(true);
    try {
      await onSend(t, atts);
      setText("");
      setAtts([]);
    } catch (error) {
      toastError("Message not sent", error);
    } finally {
      setSending(false);
    }
  }, [text, atts, onSend, disabled, sending]);
  // Enter sends, Shift+Enter breaks the line (hardware keyboards; mobile soft keyboards send with the button).
  const onKeyPress = useCallback(
    (e: KeyEvent) => {
      const k = e.nativeEvent.key;
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
    [slashOpen, matches, hi, pickCommand, submit],
  );
  const addAtts = useCallback((more: Attachment[]) => setAtts((a) => [...a, ...more]), []);
  const removeAtt = useCallback((id: string) => setAtts((a) => a.filter((x) => x.id !== id)), []);
  const anchor = useRef<View>(null);
  const input = useRef<TextInput>(null);
  usePasteImages(input, addAtts, !!attach && !disabled);
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
      <Cut size={10} style={s.box}>
        {notices}
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
          {attach ? <AttachMenu onAdd={addAtts} /> : <Plus size={16} color={color.muted} />}
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
          {onStop && empty ? (
            <Pressable onPress={onStop} accessibilityLabel="Stop">
              <Cut size={6} style={[s.send, s.stop]}>
                <Square size={11} color={color.coral} fill={color.coral} />
              </Cut>
            </Pressable>
          ) : (
            <Pressable
              onPress={submit}
              disabled={disabled || sending || empty}
              accessibilityRole="button"
              accessibilityState={sendState}
              accessibilityLabel="Send"
            >
              <Cut size={6} style={[s.send, (empty || disabled || sending) && s.idle]}>
                <ArrowUp size={16} color={color.onAccent} strokeWidth={2.2} />
              </Cut>
            </Pressable>
          )}
        </View>
      </Cut>
    </View>
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
  },
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
