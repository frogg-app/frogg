import { X } from "lucide-react-native";
import { useMemo, useRef } from "react";
import { Image, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
import { color, web } from "../../theme/tokens";
import { exitPointer, riseStyle, scrimStyle, usePresence } from "../presence";
import { useModalLayer } from "../shell/modalStack";
import { T } from "../Text";

/**
 * One image at the largest size the window allows, on the dialog scrim. The backdrop, the close
 * button and Esc close it; it enters and leaves with the dialogs' rise and fade.
 */
export function Lightbox({
  uri,
  alt,
  open,
  onClose,
}: {
  uri: string;
  alt: string;
  open: boolean;
  onClose: () => void;
}) {
  const { mounted, closing } = usePresence(open);
  const root = useRef<View>(null);
  useModalLayer(open, onClose, root);
  const source = useMemo(() => ({ uri }), [uri]);
  const panel = useMemo(() => [s.panel, riseStyle(closing)], [closing]);
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
          accessibilityLabel="Close image"
        />
        <View style={panel} ref={root} pointerEvents="box-none">
          <Image
            source={source}
            style={s.img}
            resizeMode="contain"
            accessibilityLabel={alt || "Image"}
          />
          {!!alt && alt !== "Image" && (
            <T v="mono" numberOfLines={1} style={s.alt}>
              {alt}
            </T>
          )}
        </View>
        <Pressable onPress={onClose} accessibilityLabel="Close" hitSlop={10} style={s.close}>
          {({ hovered }) => <X size={18} color={hovered ? color.text : color.muted} />}
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(4,7,9,0.86)",
    ...web({ backdropFilter: "blur(6px)" }),
  },
  panel: { width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 10 },
  img: { width: "100%", flex: 1 },
  alt: { fontSize: 11.5, color: color.muted },
  close: {
    position: "absolute",
    top: 18,
    right: 18,
    padding: 6,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line2,
  },
});
