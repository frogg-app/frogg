import { useMemo, type ReactNode, type RefObject } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";

export interface FloatingProps {
  /** The View the panel hangs off. */
  anchor: RefObject<View | null>;
  /** Preferred side; flips when the other side has more room. */
  up?: boolean;
  /** Align the panel's right edge with the anchor's. */
  right?: boolean;
  /** Panel width in px; omitted means the anchor's width. */
  width?: number;
  gap?: number;
  /** Render prop: `up` is the side actually used, `maxHeight` the room available there. */
  children: (placed: { up: boolean; maxHeight: number }) => ReactNode;
}

const ROOM = 380;

/**
 * Native fallback: hangs the panel off its parent in place (no clip-path on native). The web
 * build portals into document.body with fixed positioning, flip and viewport clamp.
 */
export function Floating({ up = false, right, width, gap = 4, children }: FloatingProps) {
  const size = useMemo<ViewStyle>(
    () =>
      up
        ? { width: width ?? ("100%" as const), marginBottom: gap }
        : { width: width ?? ("100%" as const), marginTop: gap },
    [up, width, gap],
  );
  return (
    <View style={[s.box, up ? s.up : s.down, right ? s.right : s.left, size]}>
      {children({ up, maxHeight: ROOM })}
    </View>
  );
}

const s = StyleSheet.create({
  box: { position: "absolute", zIndex: 40, maxWidth: "100%" },
  up: { bottom: "100%" },
  down: { top: "100%" },
  left: { left: 0 },
  right: { right: 0 },
});
