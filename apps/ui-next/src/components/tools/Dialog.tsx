import { X } from "lucide-react-native";
import { useMemo, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
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
  const card = useMemo(() => [s.card, { width, maxWidth: "94%" as const }], [width]);
  return (
    <Modal transparent visible={open} onRequestClose={onClose} animationType="fade">
      <View style={s.wrap}>
        <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close dialog" />
        <Cut size={14} style={card}>
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
  card: {
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
