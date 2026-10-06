import { Platform, StyleSheet, View, type ViewProps, type ViewStyle } from "react-native";

/** Style keys that paint the shape; on web they move onto a clipped layer behind the content. */
const PAINT = new Set([
  "backgroundColor", "backgroundImage", "borderWidth", "borderColor", "borderTopWidth", "borderTopColor",
  "borderBottomWidth", "borderBottomColor", "borderLeftWidth", "borderLeftColor", "borderRightWidth",
  "borderRightColor", "filter",
]);

function polygon(size: number, flip: boolean): string {
  return flip
    ? `polygon(0 0, calc(100% - ${size}px) 0, 100% ${size}px, 100% 100%, ${size}px 100%, 0 calc(100% - ${size}px))`
    : `polygon(${size}px 0, 100% 0, 100% calc(100% - ${size}px), calc(100% - ${size}px) 100%, 0 100%, 0 ${size}px)`;
}

/**
 * The bracket shape: two opposite corners chamfered. `size` is the chamfer in px,
 * `flip` cuts top-right/bottom-left instead of top-left/bottom-right.
 * Only the painted layer is clipped, so menus and tooltips inside can overflow it.
 * Native falls back to a plain box for now.
 */
export function Cut({ size = 8, flip = false, style, children, ...rest }: ViewProps & { size?: number; flip?: boolean }) {
  if (Platform.OS !== "web") return <View {...rest} style={style}>{children}</View>;
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const paint: Record<string, unknown> = {};
  const box: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (PAINT.has(k) ? paint : box)[k] = v;
  // Borders drawn on the layer must not shift the content, so pad the box by the same width.
  const bw = typeof paint.borderWidth === "number" ? paint.borderWidth : 0;
  return (
    // `isolation` keeps the layer's negative z-index inside this box instead of behind the page.
    <View {...rest} style={[box as ViewStyle, { isolation: "isolate" } as ViewStyle, bw ? { borderWidth: bw, borderColor: "transparent" } : null]}>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { margin: bw ? -bw : 0 }, paint as ViewStyle, { clipPath: polygon(size, flip), zIndex: -1 } as ViewStyle]}
      />
      {children}
    </View>
  );
}
