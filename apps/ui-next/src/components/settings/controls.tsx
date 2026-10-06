import { useCallback, useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { color, font, web } from "../../theme/tokens";
import { T } from "../Text";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={s.section}>
      <T style={s.sectionT}>{title}</T>
      <View style={s.card}>{children}</View>
    </View>
  );
}

export function Row({
  label,
  hint,
  children,
  last,
}: {
  label: string;
  hint?: string;
  children?: ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[s.row, !last && s.rowLine]}>
      <View style={s.rowText}>
        <T style={s.label}>{label}</T>
        {hint && <T style={s.hint}>{hint}</T>}
      </View>
      {children}
    </View>
  );
}

export function Toggle({
  value,
  onChange,
  disabled,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const flip = useCallback(() => onChange(!value), [onChange, value]);
  const state = useMemo(() => ({ checked: value, disabled }), [value, disabled]);
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={state}
      disabled={disabled}
      onPress={flip}
      style={[s.track, value && s.trackOn, disabled && s.disabled]}
    >
      <View style={[s.knob, value && s.knobOn]} />
    </Pressable>
  );
}

export function Seg<V extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<[V, string]>;
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <View style={s.seg}>
      {options.map(([v, label]) => (
        <SegItem key={v} value={v} label={label} on={value === v} onPick={onChange} />
      ))}
    </View>
  );
}

function SegItem<V extends string>({
  value,
  label,
  on,
  onPick,
}: {
  value: V;
  label: string;
  on: boolean;
  onPick: (v: V) => void;
}) {
  const press = useCallback(() => onPick(value), [onPick, value]);
  return (
    <Pressable onPress={press} style={[s.segI, on && s.segOn]}>
      <T style={on ? s.segTOn : s.segT}>{label}</T>
    </Pressable>
  );
}

export function Area({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <TextInput
      multiline
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={color.faint}
      style={s.area}
    />
  );
}

// Pills come in a few tints; build each style once.
const pillCache = new Map<string, { box: object; text: object }>();
function pillStyle(tint: string) {
  let style = pillCache.get(tint);
  if (!style) {
    const st = StyleSheet.create({
      box: {
        borderWidth: 1,
        borderColor: tint,
        paddingHorizontal: 6,
        paddingVertical: 1,
      },
      text: { color: tint, fontSize: 10.5 },
    });
    style = { box: st.box, text: st.text };
    pillCache.set(tint, style);
  }
  return style;
}

export function Pill({ text, tint = color.muted }: { text: string; tint?: string }) {
  const st = pillStyle(tint);
  return (
    <View style={st.box}>
      <T v="mono" style={st.text}>
        {text}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  section: { marginBottom: 26 },
  sectionT: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: 1.6,
    color: color.muted,
    textTransform: "uppercase",
    fontWeight: "600",
    marginBottom: 8,
  },
  card: { backgroundColor: color.panel },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowLine: { borderBottomWidth: 1, borderBottomColor: color.line },
  rowText: { flex: 1, minWidth: 180 },
  label: { fontWeight: "500" },
  hint: { color: color.faint, fontSize: 12.5, marginTop: 3, lineHeight: 18 },
  track: {
    width: 32,
    height: 18,
    padding: 2,
    backgroundColor: "rgba(255,255,255,0.12)",
    ...web({ transition: "background-color .25s" }),
  },
  trackOn: {
    backgroundColor: color.cyan,
    ...web({ backgroundImage: "linear-gradient(135deg,#7fd9e6,#045b9d)" }),
  },
  disabled: { opacity: 0.4 },
  knob: {
    width: 14,
    height: 14,
    backgroundColor: color.muted,
    ...web({ transition: "transform .3s cubic-bezier(0.22,1,0.36,1)" }),
  },
  knobOn: { backgroundColor: "#fff", transform: [{ translateX: 14 }] },
  seg: { flexDirection: "row", borderWidth: 1, borderColor: color.line2 },
  segI: { paddingHorizontal: 11, paddingVertical: 5 },
  segOn: { backgroundColor: "rgba(255,255,255,0.08)" },
  segT: { fontSize: 12.5, color: color.faint },
  segTOn: { fontSize: 12.5, color: color.text },
  area: {
    width: "100%",
    minHeight: 110,
    padding: 12,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12.5,
    lineHeight: 19,
    ...web({ outlineStyle: "none", resize: "vertical" }),
  },
});
