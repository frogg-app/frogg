import { ArrowUp, Mic, Plus, Square } from "lucide-react-native";
import { useCallback, useState, type ReactNode } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { color, font, web } from "../theme/tokens";
import { Cut } from "./Cut";
import { T } from "./Text";

type KeyEvent = NativeSyntheticEvent<TextInputKeyPressEventData & { shiftKey?: boolean }>;

export function Composer({
  placeholder,
  chips,
  onSend,
  compact,
  onStop,
  children,
}: {
  placeholder: string;
  chips: string[];
  onSend: (text: string) => void;
  compact?: boolean;
  onStop?: () => void;
  /** Live pickers (model, mode), drawn after the static chips. */
  children?: ReactNode;
}) {
  const [text, setText] = useState("");
  const empty = !text.trim();
  const submit = useCallback(() => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  }, [text, onSend]);
  // Enter sends, Shift+Enter breaks the line (hardware keyboards; mobile soft keyboards send with the button).
  const onKeyPress = useCallback(
    (e: KeyEvent) => {
      if (e.nativeEvent.key === "Enter" && !e.nativeEvent.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );
  return (
    <Cut size={10} style={s.box}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={color.faint}
        multiline
        style={[s.input, compact && s.compact]}
        onKeyPress={onKeyPress}
      />
      <View style={s.bar}>
        <Plus size={16} color={color.muted} />
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
        <Mic size={16} color={color.muted} />
        {onStop && empty ? (
          <Pressable onPress={onStop} accessibilityLabel="Stop">
            <Cut size={6} style={[s.send, s.stop]}>
              <Square size={11} color={color.coral} fill={color.coral} />
            </Cut>
          </Pressable>
        ) : (
          <Pressable onPress={submit} accessibilityLabel="Send">
            <Cut size={6} style={[s.send, empty && s.idle]}>
              <ArrowUp size={16} color={color.onAccent} strokeWidth={2.2} />
            </Cut>
          </Pressable>
        )}
      </View>
    </Cut>
  );
}

const s = StyleSheet.create({
  box: {
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
  },
  input: {
    minHeight: 48,
    color: color.text,
    fontFamily: font.body,
    fontSize: 14,
    lineHeight: 20,
    ...web({ outlineStyle: "none", resize: "none" }),
  },
  compact: { minHeight: 40 },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  spacer: { flex: 1 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.05)",
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
    backgroundColor: "rgba(255,107,107,0.14)",
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
      backgroundImage: "linear-gradient(135deg, #7fd9e6, #25b5c8 60%, #045b9d)",
    }),
  },
});
