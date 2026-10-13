import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Polygon, Stop } from "react-native-svg";
import { color } from "../theme/tokens";
import { isNative, useReduceMotion } from "./nativeMotion";

/**
 * Logo motion on the gem's own four faces (top, right, bottom, left, exactly as drawn at rest);
 * nothing finer. Colours run along the frogg.dev palette deep -> cyan -> mint.
 * - ripple: hover cycles a light wave face to face; press sends one quick pulse round the faces.
 * - split: hover breathes the faces apart ~0.5px; press opens dark seams along the face normals
 *   (about 3px at 48, 1px at 26) and snaps back with a small overshoot.
 * - sweep: hover runs a light band across the gem, lighting each face and glinting the edges
 *   between them as it passes; press flashes the edges and vertices.
 * - turn: the light moves round the gem, so the faces swap shading as if it rotated; hover turns
 *   it one step, press spins the light a full turn.
 */
export type LogoMotion = "none" | "ripple" | "split" | "sweep" | "turn";

type P = readonly [number, number];
interface Face {
  id: string;
  pts: P[];
  /** Outward direction, radians, y down. */
  dir: number;
  /** Centroid. */
  c: P;
}

const C: P = [12, 12];
const face = (id: string, pts: P[]): Face => {
  const c: P = [
    pts.reduce((a, p) => a + p[0], 0) / pts.length,
    pts.reduce((a, p) => a + p[1], 0) / pts.length,
  ];
  return { id, pts, c, dir: Math.atan2(c[1] - C[1], c[0] - C[0]) };
};
// Clockwise from the lit top face, matching the static mark's overlays.
const FACES: Face[] = [
  face("top", [
    [12, 1],
    [22, 7],
    [12, 12],
  ]),
  face("right", [
    [22, 7],
    [22, 17],
    [12, 23],
    [12, 12],
  ]),
  face("bottom", [
    [12, 23],
    [2, 17],
    [12, 12],
  ]),
  face("left", [
    [2, 17],
    [2, 7],
    [12, 1],
    [12, 12],
  ]),
];
const OUTER: P[] = [
  [12, 1],
  [22, 7],
  [22, 17],
  [12, 23],
  [2, 17],
  [2, 7],
];
const EDGES: (readonly [P, P])[] = [
  ...OUTER.map((o, i) => [o, OUTER[(i + 1) % 6]] as const),
  [C, [12, 1]],
  [C, [22, 7]],
  [C, [12, 23]],
  [C, [2, 17]],
];
const VERTS: P[] = [C, ...OUTER];
const key = (p: P) => p.join();
const pts = (f: Face, dx = 0, dy = 0) => f.pts.map((p) => `${p[0] + dx},${p[1] + dy}`).join(" ");

const rgb = (hex: string): number[] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const DEEP = rgb(color.deep);
const CYAN = rgb(color.cyan);
const MINT = rgb(color.mint);
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
const css = (c: number[]) => `rgb(${c.map((x) => Math.round(x)).join(",")})`;
/** 0 deep, 0.5 cyan, 1 mint. */
const palette = (w: number) =>
  css(w < 0.5 ? mix(DEEP, CYAN, w * 2) : mix(CYAN, MINT, (w - 0.5) * 2));

const ease = (x: number) => 1 - (1 - x) ** 3;
const HOVER_IN = 260;
const PRESS = 600;

/** Drives a frame clock while hovered or settling from a press; idle costs nothing. */
function useClock(enabled: boolean) {
  const [now, setNow] = useState(0);
  const hoverAt = useRef<number | null>(null);
  const leaveAt = useRef<number | null>(null);
  const leaveFrom = useRef(0);
  const pressAt = useRef<number | null>(null);
  const raf = useRef<number | null>(null);
  const t0 = useRef(0);

  const level = useCallback((t: number) => {
    if (hoverAt.current !== null) return ease(Math.min(1, (t - hoverAt.current) / HOVER_IN));
    if (leaveAt.current !== null)
      return leaveFrom.current * (1 - ease(Math.min(1, (t - leaveAt.current) / HOVER_IN)));
    return 0;
  }, []);

  const tick = useCallback(() => {
    const t = performance.now() - t0.current;
    setNow(t);
    const pressing = pressAt.current !== null && t - pressAt.current < PRESS;
    if (hoverAt.current !== null || pressing || level(t) > 0.001) {
      raf.current = requestAnimationFrame(tick);
    } else {
      raf.current = null;
      leaveAt.current = null;
      pressAt.current = null;
      setNow(0);
    }
  }, [level]);

  const start = useCallback(() => {
    if (raf.current === null) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  useEffect(() => {
    t0.current = performance.now();
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, []);

  const onEnter = useCallback(() => {
    if (!enabled) return;
    hoverAt.current = performance.now() - t0.current;
    leaveAt.current = null;
    start();
  }, [enabled, start]);
  const onLeave = useCallback(() => {
    if (!enabled || hoverAt.current === null) return;
    const t = performance.now() - t0.current;
    leaveFrom.current = level(t);
    hoverAt.current = null;
    leaveAt.current = t;
    start();
  }, [enabled, level, start]);
  const onPress = useCallback(() => {
    if (!enabled) return;
    pressAt.current = performance.now() - t0.current;
    start();
  }, [enabled, start]);

  const hover = level(now);
  const pressP =
    pressAt.current !== null && now - pressAt.current < PRESS
      ? Math.max(0, (now - pressAt.current) / PRESS)
      : -1;
  return { now, hover, press: pressP, onEnter, onLeave, onPress };
}

// Overflow room around the 24-unit mark so faces can move without layout shift.
const PAD = 4;
const VB = `${-PAD} ${-PAD} ${24 + PAD * 2} ${24 + PAD * 2}`;

/** Faceted gem mark, after the frogg.dev logo. Animated marks run at 20px and up; hover is pointer-only, press works on touch. */
export function Logo({ size = 24, motion = "none" }: { size?: number; motion?: LogoMotion }) {
  const reduced = useReduceMotion();
  const enabled = motion !== "none" && !reduced && size >= 20;
  const { now, hover, press, onEnter, onLeave, onPress } = useClock(enabled);
  const active = enabled && (hover > 0.001 || press >= 0);
  const split = active && motion === "split";
  const turn = active && motion === "turn";
  const outer = (size * (24 + PAD * 2)) / 24;
  const box = { width: size, height: size };
  const svgPos = { width: outer, height: outer, left: (-size * PAD) / 24, top: (-size * PAD) / 24 };
  const f: Frame = { t: now, hover, press, size };

  return (
    <View
      style={[s.box, box]}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onPress}
      onTouchStart={isNative ? onPress : undefined}
    >
      <View style={[s.svg, svgPos]} pointerEvents="none">
        <Svg width={outer} height={outer} viewBox={VB}>
          <Defs>
            <LinearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={color.cyan2} />
              <Stop offset="1" stopColor={color.deep} />
            </LinearGradient>
            <LinearGradient id="lgf" gradientUnits="userSpaceOnUse" x1="2" y1="1" x2="22" y2="23">
              <Stop offset="0" stopColor={color.cyan2} />
              <Stop offset="1" stopColor={color.deep} />
            </LinearGradient>
          </Defs>
          {split && <Split {...f} />}
          {turn && <Turn {...f} />}
          {!split && !turn && (
            <G>
              <Polygon points="12,1 22,7 22,17 12,23 2,17 2,7" fill="url(#lg)" />
              <Polygon points="12,1 22,7 12,12" fill="#ffffff" opacity={0.28} />
              <Polygon points="2,17 12,12 12,23" fill="#000000" opacity={0.25} />
            </G>
          )}
          {active && motion === "ripple" && <Ripple {...f} />}
          {active && motion === "sweep" && <Sweep {...f} />}
        </Svg>
      </View>
    </View>
  );
}

interface Frame {
  t: number;
  hover: number;
  press: number;
  size: number;
}

/** Rest shading of a face for a light at angle `light` (rest light is toward the top face). */
function restShade(f: Face, light: number) {
  const k = Math.cos(f.dir - light);
  return k >= 0 ? { fill: "#ffffff", opacity: 0.28 * k } : { fill: "#000000", opacity: 0.25 * -k };
}
const REST_LIGHT = FACES[0].dir;

function FacePoly({
  f,
  dx = 0,
  dy = 0,
  light = REST_LIGHT,
}: {
  f: Face;
  dx?: number;
  dy?: number;
  light?: number;
}) {
  const sh = restShade(f, light);
  const p = pts(f, dx, dy);
  return (
    <G>
      <Polygon points={p} fill="url(#lgf)" />
      <Polygon points={p} fill={sh.fill} opacity={sh.opacity} />
    </G>
  );
}

function Ripple({ t, hover, press }: Frame) {
  const phase = t / 1100;
  return (
    <G>
      {FACES.map((f, i) => {
        // Wave: each face a quarter-cycle behind the last, deep -> cyan -> mint as it peaks.
        const w = 0.5 + 0.5 * Math.cos(2 * Math.PI * (phase - i / 4));
        // Press pulse: one quick lap, face by face.
        const pulse = press >= 0 ? Math.exp(-((press * 5 - i - 0.6) ** 2) * 2.2) : 0;
        const op = Math.min(0.85, hover * (0.12 + 0.4 * w) + pulse * 0.75);
        return (
          <Polygon
            key={f.id}
            points={pts(f)}
            fill={palette(Math.max(w * hover, pulse))}
            opacity={op}
          />
        );
      })}
    </G>
  );
}

function Split({ hover, press, size }: Frame) {
  const unit = 24 / size;
  const peakPx = Math.max(0.8, (size - 16) / 10.7);
  let out = 0;
  if (press >= 0) {
    // Out fast, then a damped spring back with a small inward overshoot.
    const q = (press - 0.22) / 0.78;
    out = press < 0.22 ? ease(press / 0.22) : Math.exp(-4 * q) * Math.cos(Math.PI * 1.5 * q);
  }
  const d = (hover * 0.5 + out * peakPx) * unit;
  return (
    <G>
      {FACES.map((f) => (
        <FacePoly key={f.id} f={f} dx={Math.cos(f.dir) * d} dy={Math.sin(f.dir) * d} />
      ))}
    </G>
  );
}

function Sweep({ t, hover, press }: Frame) {
  // Band runs top-left to bottom-right along x + y, once every 900ms while hovered.
  const band = ((t / 900) % 1) * 56 - 6;
  const near = (p: P) => Math.exp(-((p[0] + p[1] - band) ** 2) * 0.02) * hover;
  const flash = press >= 0 ? 1 - ease(press) : 0;
  return (
    <G>
      {FACES.map((f) => (
        <Polygon key={f.id} points={pts(f)} fill={color.cyan2} opacity={near(f.c) * 0.5} />
      ))}
      {EDGES.map(([a, b]) => {
        const m: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        return (
          <Line
            key={`${key(a)}-${key(b)}`}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke={color.mint}
            strokeWidth={0.4}
            strokeLinecap="round"
            opacity={Math.min(1, near(m) * 1.1 + flash)}
          />
        );
      })}
      {flash > 0 &&
        VERTS.map((p) => (
          <Circle
            key={key(p)}
            cx={p[0]}
            cy={p[1]}
            r={0.5 + flash * 0.6}
            fill={color.mint}
            opacity={flash}
          />
        ))}
    </G>
  );
}

function Turn({ hover, press }: Frame) {
  // Clockwise: hover moves the light one face round; press spins it a full turn.
  const step = Math.PI / 2;
  const light = REST_LIGHT + hover * step + (press >= 0 ? ease(press) * Math.PI * 2 : 0);
  return (
    <G>
      {FACES.map((f) => (
        <FacePoly key={f.id} f={f} light={light} />
      ))}
    </G>
  );
}

const s = StyleSheet.create({
  box: { position: "relative" },
  svg: { position: "absolute" },
});
