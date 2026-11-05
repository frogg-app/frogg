import { useCallback, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  type KeyboardEvent,
  type ViewProps,
} from "react-native";

/**
 * Keeps its content above the software keyboard.
 *
 * Android runs edge-to-edge, where adjustResize no longer shrinks the window (and never does
 * for a Modal's window), so the IME would cover composers and footers. Rather than assume either
 * behaviour, the frame measures how far its own bottom edge sits below the keyboard's top and
 * pads exactly that much: zero where the window already resized, the full overlap where not.
 */
export function KeyboardFrame({ children, style }: ViewProps) {
  if (Platform.OS === "ios")
    return (
      <KeyboardAvoidingView behavior="padding" style={style}>
        {children}
      </KeyboardAvoidingView>
    );
  if (Platform.OS === "android") return <AndroidFrame style={style}>{children}</AndroidFrame>;
  return <View style={style}>{children}</View>;
}

function AndroidFrame({ children, style }: ViewProps) {
  const ref = useRef<View>(null);
  const kbTop = useRef<number | null>(null);
  const [pad, setPad] = useState(0);
  const measure = useCallback(() => {
    const top = kbTop.current;
    if (top == null) {
      setPad(0);
      return;
    }
    // The frame's own bottom does not move with its padding, so re-measuring is stable.
    ref.current?.measureInWindow((_x, y, _w, h) => {
      setPad(Math.max(0, Math.round(y + h - top)));
    });
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e: KeyboardEvent) => {
      kbTop.current = e.endCoordinates.screenY;
      measure();
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      kbTop.current = null;
      setPad(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [measure]);
  return (
    <View ref={ref} style={[style, pad > 0 && { paddingBottom: pad }]} onLayout={measure}>
      {children}
    </View>
  );
}
