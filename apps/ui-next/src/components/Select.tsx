import { Check, ChevronDown } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type TextStyle,
} from "react-native";
import { exitPointer, popStyle, scrimStyle, sheetStyle, usePresence } from "./presence";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { bp, color, overlayMs, web } from "../theme/tokens";
import { Cut } from "./Cut";
import { Floating } from "./Floating";
import { T } from "./Text";

export interface Option<V extends string> {
  value: V;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/**
 * A bracket-styled dropdown. On wide web the menu floats over the page next to the field (above with `up`,
 * flipping when there is no room); on native and narrow widths it opens as a bottom sheet in a modal, so it never
 * fights sibling stacking or clipping.
 */
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
  label,
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
  /** Heading for the sheet on phone/native; defaults to the placeholder. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const narrow = useWindowDimensions().width < bp.tablet;
  const sheet = Platform.OS !== "web" || narrow;
  const close = useCallback(() => setOpen(false), []);
  const current = options.find((o) => o.value === value);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const pick = useCallback(
    (v: V) => {
      setOpen(false);
      onChange(v);
    },
    [onChange],
  );
  const wrap = useMemo(() => ({ width, zIndex: open && !sheet ? 40 : 1 }), [width, open, sheet]);
  const drop = usePresence(open && !sheet);
  const anchor = useRef<View>(null);
  const closing = drop.closing;
  const menu = useCallback(
    (p: { up: boolean; maxHeight: number }) => (
      <View style={popStyle(closing, p.up, false)} pointerEvents={exitPointer(closing)}>
        <Cut size={8} flip style={s.menuPaint}>
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
      </View>
    ),
    [closing, options, value, mono, pick],
  );
  let fieldText: TextStyle = s.fieldText;
  if (chip) fieldText = s.fieldTextChip;
  else if (mono) fieldText = s.fieldTextMono;
  return (
    <View style={wrap} ref={anchor}>
      <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={label}>
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
      {sheet && (
        <SelectSheet
          open={open}
          title={label ?? placeholder}
          options={options}
          value={value}
          mono={!!mono}
          onPick={pick}
          onClose={close}
        />
      )}
      {drop.mounted && !sheet && (
        <Floating anchor={anchor} up={up} width={menuWidth}>
          {menu}
        </Floating>
      )}
    </View>
  );
}

function SelectSheet<V extends string>({
  open,
  title,
  options,
  value,
  mono,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  options: Array<Option<V>>;
  value: V | null;
  mono: boolean;
  onPick: (v: V) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { mounted, closing } = usePresence(open, overlayMs.out + 30);
  const panel = useMemo(
    () => [s.sheet, { paddingBottom: Math.max(insets.bottom, 12) }, sheetStyle(closing)],
    [insets.bottom, closing],
  );
  return (
    <Modal
      visible={mounted}
      transparent
      animationType={Platform.OS === "web" ? "none" : "fade"}
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={s.sheetLayer} pointerEvents={exitPointer(closing)}>
        <Pressable
          style={[s.sheetScrim, scrimStyle(closing)]}
          onPress={onClose}
          accessibilityLabel="Close"
        />
        <View style={panel}>
          <View style={s.grab} />
          <T v="label" style={s.sheetTitle}>
            {title}
          </T>
          <ScrollView style={s.sheetScroll}>
            {options.length === 0 && <T style={s.empty}>Nothing to choose yet</T>}
            {options.map((o) => (
              <OptionRow
                key={o.value}
                option={o}
                selected={o.value === value}
                mono={mono}
                onPick={onPick}
                large
              />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function OptionRow<V extends string>({
  option,
  selected,
  mono,
  onPick,
  large,
}: {
  option: Option<V>;
  selected: boolean;
  mono: boolean;
  onPick: (v: V) => void;
  large?: boolean;
}) {
  const onPress = useCallback(() => onPick(option.value), [onPick, option.value]);
  return (
    <Pressable disabled={option.disabled} onPress={onPress}>
      {({ hovered }) => (
        <View
          style={[
            s.opt,
            large && s.optLarge,
            (hovered || (large && selected)) && s.optHover,
            option.disabled && s.optDisabled,
          ]}
        >
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
    backgroundColor: color.wash2,
    gap: 6,
  },
  chipHover: { backgroundColor: color.wash3 },
  menuPaint: {
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line2,
    paddingVertical: 4,
    ...web({ boxShadow: "0 16px 40px #000a" }),
  },
  scroll: { maxHeight: 260 },
  opt: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  optHover: { backgroundColor: color.cyanWash },
  optDisabled: { opacity: 0.4 },
  optBody: { flex: 1 },
  optLabel: { color: color.text, fontSize: 13.5 },
  optMono: { color: color.text, fontSize: 12.5 },
  hint: { color: color.faint, fontSize: 11.5, marginTop: 2 },
  optLarge: { minHeight: 48, paddingHorizontal: 18, paddingVertical: 10 },
  sheetLayer: { flex: 1, justifyContent: "flex-end" },
  sheetScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.scrim,
  },
  sheet: {
    maxHeight: "70%",
    backgroundColor: color.raise,
    borderTopWidth: 1,
    borderTopColor: color.cyan,
    paddingTop: 8,
  },
  grab: {
    alignSelf: "center",
    width: 36,
    height: 4,
    backgroundColor: color.line2,
    marginBottom: 10,
  },
  sheetTitle: { paddingHorizontal: 18, paddingBottom: 8 },
  sheetScroll: { flexGrow: 0 },
  empty: { color: color.faint, paddingHorizontal: 18, paddingVertical: 14 },
});
