import { Check, ChevronRight, type LucideIcon } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { color, web } from "../../theme/tokens";
import { Cut } from "../Cut";
import { T } from "../Text";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A pressable anchor for a popover: `ref` goes on the trigger's View, `open()` measures it. */
export function useAnchor() {
  const ref = useRef<View>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const open = useCallback(() => {
    ref.current?.measureInWindow((x, y, w, h) => setRect({ x, y, w, h }));
  }, []);
  const close = useCallback(() => setRect(null), []);
  return { ref, rect, open, close };
}

/**
 * Floats `children` next to an anchor rect, above everything, with a click-away backdrop.
 * Uses a transparent Modal so it escapes scroll views and clipping on web and native alike.
 */
export function Popover({
  rect,
  onClose,
  right,
  width = 260,
  children,
}: {
  rect: Rect | null;
  onClose: () => void;
  /** Align the popover's right edge with the anchor's. */
  right?: boolean;
  width?: number;
  children: ReactNode;
}) {
  const win = useWindowDimensions();
  const [h, setH] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setH(e.nativeEvent.layout.height), []);
  const pos = useMemo(() => {
    if (!rect) return null;
    const w = Math.min(width, win.width - 16);
    let x = right ? rect.x + rect.w - w : rect.x;
    x = Math.max(8, Math.min(win.width - w - 8, x));
    let y = rect.y + rect.h + 6;
    if (h && y + h > win.height - 8) y = Math.max(8, rect.y - h - 6);
    return { left: x, top: y, width: w, maxHeight: win.height - 16 };
  }, [rect, right, width, win.width, win.height, h]);
  return (
    <Modal transparent visible={!!rect} onRequestClose={onClose} animationType="none">
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      {pos && (
        <Cut size={8} flip style={[s.pop, pos]} onLayout={onLayout}>
          {children}
        </Cut>
      )}
    </Modal>
  );
}

export type MenuEntry =
  | "-"
  | { head: string }
  | {
      label: string;
      hint?: string;
      kbd?: string;
      icon?: LucideIcon;
      on?: boolean;
      danger?: boolean;
      warn?: boolean;
      disabled?: boolean;
      sub?: boolean;
      onPress?: () => void;
    };

type Item = Exclude<MenuEntry, "-" | { head: string }>;

/** The round-4 menu: rows with hint lines, kbd chips, checkmarks, section heads and rules. */
export function Menu({
  rect,
  onClose,
  items,
  right,
  width = 260,
}: {
  rect: Rect | null;
  onClose: () => void;
  items: MenuEntry[];
  right?: boolean;
  width?: number;
}) {
  const keyed = useMemo(
    () =>
      items.map((it, n) => {
        if (it === "-") return { key: `rule-${n}`, it };
        if ("head" in it) return { key: `head-${it.head}`, it };
        return { key: `item-${it.label}`, it };
      }),
    [items],
  );
  return (
    <Popover rect={rect} onClose={onClose} right={right} width={width}>
      <ScrollView style={s.scroll}>
        {keyed.map(({ key, it }) => {
          if (it === "-") return <View key={key} style={s.rule} />;
          if ("head" in it)
            return (
              <T key={key} v="label" style={s.head}>
                {it.head}
              </T>
            );
          return <MenuRow key={key} item={it} onClose={onClose} />;
        })}
      </ScrollView>
    </Popover>
  );
}

function hintStyle(item: Item) {
  if (item.warn) return s.hintWarn;
  return s.hint;
}

function MenuRow({ item, onClose }: { item: Item; onClose: () => void }) {
  const press = useCallback(() => {
    onClose();
    item.onPress?.();
  }, [item, onClose]);
  const Icon = item.icon;
  return (
    <Pressable disabled={item.disabled} onPress={press} accessibilityRole="menuitem">
      {({ hovered }) => (
        <View style={[s.row, hovered && !item.disabled && s.rowHover, item.on && s.rowOn]}>
          <View style={s.icon}>
            {Icon && <Icon size={14} color={item.disabled ? color.faint : color.muted} />}
          </View>
          <View style={s.body}>
            <T
              style={[s.label, item.danger && s.danger, item.disabled && s.disabled]}
              numberOfLines={1}
            >
              {item.label}
            </T>
            {item.hint && (
              <T style={hintStyle(item)} numberOfLines={2}>
                {item.hint}
              </T>
            )}
          </View>
          {item.kbd && (
            <T v="mono" style={s.kbd}>
              {item.kbd}
            </T>
          )}
          {item.on && <Check size={13} color={color.cyan2} />}
          {item.sub && <ChevronRight size={12} color={color.faint} />}
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  pop: {
    position: "absolute",
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line2,
    paddingVertical: 4,
    ...web({ boxShadow: "0 16px 40px #000a" }),
  },
  scroll: { flexGrow: 0 },
  rule: { height: 1, backgroundColor: color.line, marginVertical: 4, marginHorizontal: 6 },
  head: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, fontSize: 9.5 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginHorizontal: 4,
  },
  rowHover: { backgroundColor: "rgba(37,181,200,0.1)" },
  rowOn: { backgroundColor: "rgba(127,217,230,0.06)" },
  icon: { width: 14, alignItems: "center" },
  body: { flex: 1 },
  label: { fontSize: 13, color: color.text },
  danger: { color: color.coral },
  disabled: { color: color.faint },
  hint: { fontSize: 11, color: color.faint, marginTop: 1 },
  hintWarn: { fontSize: 11, color: color.amber, marginTop: 1 },
  kbd: {
    fontSize: 9.5,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: color.line2,
    color: color.faint,
  },
});
