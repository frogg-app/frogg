import { X } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { exitPointer, riseStyle, scrimStyle, usePresence } from "../presence";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { color, web } from "../../theme/tokens";
import { Cut } from "../Cut";
import { T } from "../Text";

/** Centred modal card: eyebrow, title, body, right-aligned footer. Backdrop click closes. */
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
  return (
    <Modal
      transparent
      visible={mounted}
      onRequestClose={onClose}
      animationType={Platform.OS === "web" ? "none" : "fade"}
    >
      <View style={s.wrap} pointerEvents={exitPointer(closing)}>
        <Pressable
          style={[s.backdrop, scrimStyle(closing)]}
          onPress={onClose}
          accessibilityLabel="Close dialog"
        />
        <View style={panel}>
          <Cut size={14} style={s.card}>
            <View style={s.head}>
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
            <ScrollView style={s.body} contentContainerStyle={s.bodyIn}>
              {children}
            </ScrollView>
            {footer && <View style={s.foot}>{footer}</View>}
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
  place: { maxWidth: "94%", maxHeight: "90%" },
  card: {
    flexShrink: 1,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line2,
    maxHeight: "90%",
    ...web({ boxShadow: "0 24px 60px #000c" }),
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 20, paddingBottom: 8 },
  flex: { flex: 1 },
  title: { fontSize: 19, marginTop: 6 },
  body: { flexGrow: 0 },
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
