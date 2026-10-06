import { ArrowUp, Mic, Plus, Square } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { color, font, web } from "../theme/tokens";
import { Cut } from "./Cut";
import { T } from "./Text";

export function Composer({
  placeholder, chips, onSend, compact, onStop, controls,
}: {
  placeholder: string; chips: string[]; onSend: (text: string) => void; compact?: boolean; onStop?: () => void;
  /** Live pickers (model, mode) shown in place of static chips. */
  controls?: ReactNode;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <Cut size={10} style={s.box}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={placeholder}
        placeholderTextColor={color.faint}
        multiline
        style={[s.input, compact && { minHeight: 40 }]}
        onKeyPress={(e) => {
          const ne = e.nativeEvent as unknown as { key: string; shiftKey?: boolean };
          if (ne.key === "Enter" && !ne.shiftKey) {
            (e as unknown as { preventDefault?: () => void }).preventDefault?.();
            submit();
          }
        }}
      />
      <View style={s.bar}>
        <Plus size={16} color={color.muted} />
        {chips.map((c, i) => (
          <View key={c} style={s.chip}>
            {i === 0 && <View style={s.chipDot} />}
            <T v="mono" style={{ color: color.text }}>{c}</T>
          </View>
        ))}
        {controls}
        <View style={{ flex: 1 }} />
        <Mic size={16} color={color.muted} />
        {onStop && !text.trim() ? (
          <Pressable onPress={onStop} accessibilityLabel="Stop">
            <Cut size={6} style={[s.send, s.stop]}>
              <Square size={11} color={color.coral} fill={color.coral} />
            </Cut>
          </Pressable>
        ) : (
          <Pressable onPress={submit} accessibilityLabel="Send">
            <Cut size={6} style={[s.send, !text.trim() && { opacity: 0.55 }]}>
              <ArrowUp size={16} color={color.onAccent} strokeWidth={2.2} />
            </Cut>
          </Pressable>
        )}
      </View>
    </Cut>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: color.raise, borderWidth: 1, borderColor: color.line, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  input: {
    minHeight: 48, color: color.text, fontFamily: font.body, fontSize: 14, lineHeight: 20,
    ...web({ outlineStyle: "none", resize: "none" }),
  },
  bar: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(255,255,255,0.05)", paddingHorizontal: 8, paddingVertical: 4 },
  chipDot: { width: 6, height: 6, backgroundColor: color.cyan2, transform: [{ rotate: "45deg" }] },
  stop: { backgroundColor: "rgba(255,107,107,0.14)", ...web({ backgroundImage: "none" }) },
  send: {
    width: 30, height: 30, alignItems: "center", justifyContent: "center", backgroundColor: color.cyan,
    ...web({ backgroundImage: "linear-gradient(135deg, #7fd9e6, #25b5c8 60%, #045b9d)" }),
  },
});
