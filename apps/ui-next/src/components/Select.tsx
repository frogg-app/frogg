import { Check, ChevronDown } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, type TextStyle } from "react-native";
import { color, web } from "../theme/tokens";
import { Cut } from "./Cut";
import { T } from "./Text";

export interface Option<V extends string> {
  value: V;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** A bracket-styled dropdown; the menu opens in place over what follows (or above, with `up`). */
export function Select<V extends string>({
  value,
  options,
  onChange,
  placeholder = "Choose",
  mono,
  width = 240,
  up,
  chip,
  menuWidth,
}: {
  value: V | null;
  options: Array<Option<V>>;
  onChange: (v: V) => void;
  placeholder?: string;
  mono?: boolean;
  width?: number | "100%" | "auto";
  /** Open the menu above the field (for controls near the bottom edge). */
  up?: boolean;
  /** Composer-chip look: no border, tinted fill. */
  chip?: boolean;
  menuWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const pick = useCallback(
    (v: V) => {
      setOpen(false);
      onChange(v);
    },
    [onChange],
  );
  const wrap = useMemo(() => ({ width, zIndex: open ? 40 : 1 }), [width, open]);
  const menu = useMemo(
    () => [
      s.menu,
      up && s.menuUp,
      menuWidth !== undefined && { width: menuWidth, right: undefined },
    ],
    [up, menuWidth],
  );
  let fieldText: TextStyle = s.fieldText;
  if (chip) fieldText = s.fieldTextChip;
  else if (mono) fieldText = s.fieldTextMono;
  return (
    <View style={wrap}>
      <Pressable onPress={toggle}>
        {({ hovered }) => (
          <View
            style={[
              s.field,
              chip && s.chip,
              (hovered || open) && (chip ? s.chipHover : s.fieldHover),
            ]}
          >
            <T
              v={mono ? "mono" : "body"}
              numberOfLines={1}
              style={[fieldText, !current && s.placeholder]}
            >
              {current?.label ?? placeholder}
            </T>
            <ChevronDown size={chip ? 11 : 14} color={color.faint} />
          </View>
        )}
      </Pressable>
      {open && (
        <Cut size={8} flip style={menu}>
          <ScrollView style={s.scroll}>
            {options.map((o) => (
              <OptionRow
                key={o.value}
                option={o}
                selected={o.value === value}
                mono={!!mono}
                onPick={pick}
              />
            ))}
          </ScrollView>
        </Cut>
      )}
    </View>
  );
}

function OptionRow<V extends string>({
  option,
  selected,
  mono,
  onPick,
}: {
  option: Option<V>;
  selected: boolean;
  mono: boolean;
  onPick: (v: V) => void;
}) {
  const onPress = useCallback(() => onPick(option.value), [onPick, option.value]);
  return (
    <Pressable disabled={option.disabled} onPress={onPress}>
      {({ hovered }) => (
        <View style={[s.opt, hovered && s.optHover, option.disabled && s.optDisabled]}>
          <View style={s.optBody}>
            <T v={mono ? "mono" : "body"} style={mono ? s.optMono : s.optLabel}>
              {option.label}
            </T>
            {option.hint && <T style={s.hint}>{option.hint}</T>}
          </View>
          {selected && <Check size={13} color={color.cyan2} />}
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
  },
  fieldHover: { borderColor: color.line2 },
  fieldText: { flex: 1, color: color.text, fontSize: 13.5 },
  fieldTextMono: { flex: 1, color: color.text, fontSize: 12.5 },
  fieldTextChip: { color: color.text, fontSize: 11.5 },
  placeholder: { color: color.faint },
  chip: {
    borderWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.05)",
    gap: 6,
  },
  chipHover: { backgroundColor: "rgba(255,255,255,0.1)" },
  menu: {
    position: "absolute",
    top: "100%",
    left: 0,
    right: 0,
    marginTop: 4,
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line2,
    paddingVertical: 4,
    ...web({ boxShadow: "0 16px 40px #000a" }),
  },
  menuUp: { top: undefined, bottom: "100%", marginTop: 0, marginBottom: 4 },
  scroll: { maxHeight: 260 },
  opt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optHover: { backgroundColor: "rgba(37,181,200,0.1)" },
  optDisabled: { opacity: 0.4 },
  optBody: { flex: 1 },
  optLabel: { color: color.text, fontSize: 13.5 },
  optMono: { color: color.text, fontSize: 12.5 },
  hint: { color: color.faint, fontSize: 11.5, marginTop: 2 },
});
