import { X } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { exitPointer, riseStyle, scrimStyle, usePresence } from "../presence";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useModalLayer } from "../shell/modalStack";
import { color, web } from "../../theme/tokens";
import { Cut } from "../Cut";
import { T } from "../Text";

/** Share of the space the modal gets (shrinks with the Android keyboard) the card may fill. */
const FILL = 0.9;

/**
 * Pixel heights the body fits in: the card hugs its content and the body only scrolls once the
 * whole card would pass FILL of the available height. Percentages left the body's ScrollView
 * collapsing or clipping on some layouts, so the cap is measured, not relative.
 */
function useBodyCap() {
  const [space, setSpace] = useState(0);
  const [head, setHead] = useState(0);
  const [foot, setFoot] = useState(0);
  const onSpace = useCallback((e: LayoutChangeEvent) => setSpace(e.nativeEvent.layout.height), []);
  const onHead = useCallback((e: LayoutChangeEvent) => setHead(e.nativeEvent.layout.height), []);
  const onFoot = useCallback((e: LayoutChangeEvent) => setFoot(e.nativeEvent.layout.height), []);
  // 2px: the card's top and bottom border.
  const cap = space ? Math.max(80, space * FILL - head - foot - 2) : undefined;
  const body = useMemo(() => [s.body, cap ? { maxHeight: cap } : null], [cap]);
  return { onSpace, onHead, onFoot, body };
}

/** Centred modal card: eyebrow, title, body, right-aligned footer. Backdrop click or Esc closes. */
export function Dialog({
  open,
  onClose,
  eyebrow,
  title,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const card = useMemo(() => [s.place, { width }], [width]);
  const { mounted, closing } = usePresence(open);
  const panel = useMemo(() => [card, riseStyle(closing)], [card, closing]);
  const root = useRef<View>(null);
  useModalLayer(open, onClose, root);
  const { onSpace, onHead, onFoot, body } = useBodyCap();
  return (
    <Modal
      transparent
      visible={mounted}
      onRequestClose={onClose}
      animationType={Platform.OS === "web" ? "none" : "fade"}
    >
      <View style={s.wrap} pointerEvents={exitPointer(closing)} onLayout={onSpace}>
        <Pressable
          style={[s.backdrop, scrimStyle(closing)]}
          onPress={onClose}
          accessibilityLabel="Close dialog"
        />
        <View style={panel} ref={root}>
          <Cut size={14} style={s.card}>
            <View style={s.head} onLayout={onHead}>
              <View style={s.flex}>
                {eyebrow && <T v="label">{eyebrow}</T>}
                <T v="display" style={s.title}>
                  {title}
                </T>
              </View>
              <Pressable onPress={onClose} accessibilityLabel="Close">
                <X size={14} color={color.faint} />
              </Pressable>
            </View>
            <ScrollView style={body} contentContainerStyle={s.bodyIn}>
              {children}
            </ScrollView>
            {footer && (
              <View style={s.foot} onLayout={onFoot}>
                {footer}
              </View>
            )}
          </Cut>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(4,7,9,0.72)",
    ...web({ backdropFilter: "blur(6px)" }),
  },
  place: { maxWidth: "94%" },
  card: {
    flexShrink: 1,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line2,
    ...web({ boxShadow: "0 24px 60px #000c" }),
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 20, paddingBottom: 8 },
  flex: { flex: 1 },
  title: { fontSize: 19, marginTop: 6 },
  body: { flexGrow: 0, flexShrink: 0 },
  bodyIn: { paddingHorizontal: 20, paddingBottom: 18, gap: 12 },
  foot: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    padding: 14,
    paddingHorizontal: 20,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
});
