import { useCallback, useState } from "react";
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import Svg, { Polygon } from "react-native-svg";

/** Style keys that paint the shape; on web they move onto a clipped layer behind the content. */
const PAINT = new Set([
  "backgroundColor",
  "backgroundImage",
  "borderWidth",
  "borderColor",
  "borderTopWidth",
  "borderTopColor",
  "borderBottomWidth",
  "borderBottomColor",
  "borderLeftWidth",
  "borderLeftColor",
  "borderRightWidth",
  "borderRightColor",
  "filter",
]);

/** Corner points of the chamfered outline, inset by `i` px; the chamfer shrinks so the diagonal stays parallel. */
function points(size: number, flip: boolean, i = 0): string[] {
  const c = Math.max(0, size - i * (2 - Math.SQRT2));
  const lo = `${i}px`;
  const hi = `calc(100% - ${i}px)`;
  const near = `${c + i}px`;
  const far = `calc(100% - ${c + i}px)`;
  return flip
    ? [
        `${lo} ${lo}`,
        `${far} ${lo}`,
        `${hi} ${near}`,
        `${hi} ${hi}`,
        `${near} ${hi}`,
        `${lo} ${far}`,
      ]
    : [
        `${near} ${lo}`,
        `${hi} ${lo}`,
        `${hi} ${far}`,
        `${far} ${hi}`,
        `${lo} ${hi}`,
        `${lo} ${near}`,
      ];
}

function polygon(size: number, flip: boolean, inset = 0): string {
  return `polygon(${points(size, flip, inset).join(", ")})`;
}

/**
 * The stroke as a ring: outer outline, then the outline inset by the border width, filled
 * even-odd. A CSS border on a clipped box only follows the straight sides; the clip slices the
 * corners off so the diagonals had no stroke at all. The ring gives every edge the same width.
 */
function ring(size: number, flip: boolean, width: number): string {
  const o = points(size, flip);
  const n = points(size, flip, width);
  return `polygon(evenodd, ${[...o, o[0], ...n, n[0]].join(", ")})`;
}

/**
 * The bracket shape: two opposite corners chamfered. `size` is the chamfer in px,
 * `flip` cuts top-right/bottom-left instead of top-left/bottom-right.
 * Only the painted layer is clipped, so menus and tooltips inside can overflow it.
 * Native draws the same outline as an SVG polygon behind the content (fill plus a stroke), sized
 * from the laid-out box, so the chamfer shows on device too.
 */
export function Cut({
  size = 8,
  flip = false,
  style,
  children,
  ...rest
}: ViewProps & { size?: number; flip?: boolean }) {
  if (Platform.OS !== "web")
    return (
      <NativeCut size={size} flip={flip} style={style} {...rest}>
        {children}
      </NativeCut>
    );
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const paint: Record<string, unknown> = {};
  const box: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flat)) (PAINT.has(k) ? paint : box)[k] = v;
  // Borders drawn on the layer must not shift the content, so pad the box by the same width.
  const bw = typeof paint.borderWidth === "number" ? paint.borderWidth : 0;
  const stroke = bw && typeof paint.borderColor === "string" ? paint.borderColor : null;
  const fill: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(paint)) if (!k.startsWith("border")) fill[k] = v;
  return (
    // `isolation` keeps the layer's negative z-index inside this box instead of behind the page.
    <View
      {...rest}
      style={[
        box as ViewStyle,
        { isolation: "isolate" } as ViewStyle,
        bw ? { borderWidth: bw, borderColor: "transparent" } : null,
      ]}
    >
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { margin: bw ? -bw : 0 },
          (stroke ? fill : paint) as ViewStyle,
          // The fill stops at the stroke's midline: hidden under it, never past the outer edge.
          { clipPath: polygon(size, flip, stroke ? bw / 2 : 0), zIndex: -1 } as ViewStyle,
        ]}
      />
      {stroke && (
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            {
              margin: -bw,
              backgroundColor: stroke,
              clipPath: ring(size, flip, bw),
              zIndex: -1,
            } as ViewStyle,
          ]}
        />
      )}
      {children}
    </View>
  );
}

/** Corner points of the chamfered outline for a `w` x `h` box, inset by `i`. */
function nativePoints(w: number, h: number, size: number, flip: boolean, i: number): string {
  const c = Math.max(0, size - i * (2 - Math.SQRT2));
  const l = i;
  const t = i;
  const r = w - i;
  const b = h - i;
  const pts = flip
    ? [
        [l, t],
        [r - c - i, t],
        [r, t + c + i],
        [r, b],
        [l + c + i, b],
        [l, b - c - i],
      ]
    : [
        [l + c + i, t],
        [r, t],
        [r, b - c - i],
        [r - c - i, b],
        [l, b],
        [l, t + c + i],
      ];
  return pts.map((p) => `${p[0]},${p[1]}`).join(" ");
}

function NativeCut({
  size,
  flip,
  style,
  children,
  onLayout,
  ...rest
}: ViewProps & { size: number; flip: boolean }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const layout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      setBox((old) => (old && old.w === width && old.h === height ? old : { w: width, h: height }));
      onLayout?.(e);
    },
    [onLayout],
  );
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  const { backgroundColor, borderColor, borderWidth, ...keep } = flat;
  const bw = typeof borderWidth === "number" ? borderWidth : 0;
  const stroke = bw && typeof borderColor === "string" ? borderColor : null;
  const fill = typeof backgroundColor === "string" ? backgroundColor : null;
  const painted = box && (fill || stroke);
  return (
    <View
      {...rest}
      onLayout={layout}
      style={[
        keep,
        bw ? { borderWidth: bw, borderColor: "transparent" } : null,
        !painted && fill ? { backgroundColor: fill } : null,
        !painted && stroke ? { borderColor: stroke } : null,
      ]}
    >
      {painted ? (
        <Svg
          pointerEvents="none"
          width={box.w}
          height={box.h}
          style={[ns.svg, { left: -bw, top: -bw }]}
        >
          <Polygon
            points={nativePoints(box.w, box.h, size, flip, stroke ? bw / 2 : 0)}
            fill={fill ?? "none"}
            stroke={stroke ?? "none"}
            strokeWidth={stroke ? bw : 0}
            strokeLinejoin="miter"
          />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

const ns = StyleSheet.create({ svg: { position: "absolute" } });
