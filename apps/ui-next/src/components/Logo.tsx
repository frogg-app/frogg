import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, G, Line, LinearGradient, Polygon, Stop } from "react-native-svg";
import { color } from "../theme/tokens";

/**
 * Logo motion, after the frogg.dev hero: a jittered low-poly mesh, flat-shaded per facet from a
 * moving height field (deep -> cyan -> mint at the peaks, lit from the top left).
 * - ripple: hover sets a slow noise swell rolling through the facets; press sends a ring outward.
 * - shatter: hover shimmers the facets; press bursts the triangles out and reassembles them.
 * - sweep: hover runs a light band across the facets with edges and vertices lighting; press
 *   flashes every vertex and throws the mesh lines a little past the hex.
 */
export type LogoMotion = "none" | "ripple" | "shatter" | "sweep";

type P = readonly [number, number];
type Tri = readonly [P, P, P];

const C: P = [12, 12];
const OUTER: P[] = [
  [12, 1],
  [22, 7],
  [22, 17],
  [12, 23],
  [2, 17],
  [2, 7],
];
// Inner ring, jittered like the site's grid so the mesh reads hand-cut rather than regular.
const JITTER: P[] = [
  [0.4, 0.3],
  [-0.5, 0.4],
  [0.3, -0.6],
  [-0.4, -0.2],
  [0.6, 0.1],
  [-0.2, 0.5],
];
const mid = (a: P, b: P): P => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const INNER: P[] = OUTER.map((o, i) => {
  const m = mid(C, o);
  return [m[0] + JITTER[i][0], m[1] + JITTER[i][1]] as P;
});
const EDGE: P[] = OUTER.map((o, i) => mid(o, OUTER[(i + 1) % 6]));
const TRIS: Tri[] = OUTER.flatMap((o, i) => {
  const j = (i + 1) % 6;
  const m0 = INNER[i];
  const m1 = INNER[j];
  const e = EDGE[i];
  return [
    [C, m0, m1],
    [m0, o, e],
    [m0, e, m1],
    [m1, e, OUTER[j]],
  ] as Tri[];
});
const VERTS: P[] = [C, ...INNER, ...OUTER, ...EDGE];
const SEGS: (readonly [P, P])[] = (() => {
  const seen = new Set<string>();
  const out: (readonly [P, P])[] = [];
  for (const t of TRIS)
    for (let k = 0; k < 3; k++) {
      const a = t[k];
      const b = t[(k + 1) % 3];
      const key = [a.join(), b.join()].sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        out.push([a, b]);
      }
    }
  return out;
})();

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const DEEP = rgb(color.deep);
const CYAN = rgb(color.cyan);
const MINT = rgb(color.mint);
const ICE = rgb(color.cyan2);
const LIGHT = (() => {
  const v = [-0.4, -0.8, 0.5];
  const n = Math.hypot(v[0], v[1], v[2]);
  return v.map((x) => x / n);
})();
const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => x + (b[i] - x) * t);
const css = (c: number[]) => `rgb(${c.map((x) => Math.round(Math.min(255, x))).join(",")})`;

/** Flat facet shade, as the site's fragment shader: normal from the lifted triangle, diffuse + spec. */
function shade(t: Tri, h: (p: P) => number, glow = 0): string {
  const [a, b, c] = t.map((p) => [p[0], p[1], h(p)]);
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (n[2] < 0) n = n.map((x) => -x);
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const diff = Math.max(0, (n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]) / len);
  const height = (a[2] + b[2] + c[2]) / 3;
  // Gradient position, top-left light to bottom-right deep, as the static mark.
  const g = 1 - ((a[0] + b[0] + c[0] + a[1] + b[1] + c[1]) / 6 - 1) / 22;
  const k = g + height * 0.35 + (diff - 0.49) * 0.8;
  let col = k < 0.55 ? mix(DEEP, CYAN, sstep(0, 0.55, k)) : mix(CYAN, ICE, sstep(0.55, 1.1, k));
  col = mix(col, MINT, sstep(0.9, 1.8, height + glow) * 0.6);
  col = col.map((x) => x * (0.92 + (diff - 0.49) * 0.7) + glow * 70);
  return css(col);
}

const ease = (x: number) => 1 - (1 - x) ** 3;
const HOVER_IN = 260;
const PRESS = 620;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setReduced(v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

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

// Overflow room around the 24-unit mark so lines can run past the hex without layout shift.
const PAD = 4;
const VB = `${-PAD} ${-PAD} ${24 + PAD * 2} ${24 + PAD * 2}`;

/** Faceted gem mark, after the frogg.dev logo. Animated marks run on web, at 20px and up. */
export function Logo({ size = 24, motion = "none" }: { size?: number; motion?: LogoMotion }) {
  const reduced = useReducedMotion();
  const enabled = motion !== "none" && !reduced && size >= 20 && Platform.OS === "web";
  const { now, hover, press, onEnter, onLeave, onPress } = useClock(enabled);
  const active = enabled && (hover > 0.001 || press >= 0);
  const big = size >= 26;
  const outer = (size * (24 + PAD * 2)) / 24;
  const box = { width: size, height: size };
  const svgPos = { width: outer, height: outer, left: (-size * PAD) / 24, top: (-size * PAD) / 24 };

  return (
    <View
      style={[s.box, box]}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onPress}
    >
      <View style={[s.svg, svgPos]} pointerEvents="none">
        <Svg width={outer} height={outer} viewBox={VB}>
          <Defs>
            <LinearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={color.cyan2} />
              <Stop offset="1" stopColor={color.deep} />
            </LinearGradient>
          </Defs>
          <Polygon points="12,1 22,7 22,17 12,23 2,17 2,7" fill="url(#lg)" />
          <Polygon points="12,1 22,7 12,12" fill="#ffffff" opacity={0.28} />
          <Polygon points="2,17 12,12 12,23" fill="#000000" opacity={0.25} />
          {active && motion === "ripple" && <Ripple t={now} hover={hover} press={press} />}
          {active && motion === "shatter" && <Shatter t={now} hover={hover} press={press} />}
          {active && motion === "sweep" && <Sweep t={now} hover={hover} press={press} big={big} />}
        </Svg>
      </View>
    </View>
  );
}

interface Frame {
  t: number;
  hover: number;
  press: number;
}
const pts = (t: Tri, dx = 0, dy = 0) => t.map((p) => `${p[0] + dx},${p[1] + dy}`).join(" ");
const dist = (p: P) => Math.hypot(p[0] - C[0], p[1] - C[1]);

function Ripple({ t, hover, press }: Frame) {
  const sec = t / 1000;
  const ring = press >= 0 ? ease(press) * 14 : -99;
  const ringAmp = press >= 0 ? 1 - press : 0;
  const h = (p: P) =>
    hover *
      (Math.sin(p[0] * 0.45 + sec * 4.2) * Math.cos(p[1] * 0.38 - sec * 3.1) * 0.9 +
        Math.sin(dist(p) * 0.7 - sec * 5) * 0.35) +
    ringAmp * 2.2 * Math.exp(-((dist(p) - ring) ** 2) * 0.12);
  const k = Math.max(hover, ringAmp);
  return (
    <G opacity={Math.min(1, k * 1.4)}>
      {TRIS.map((tri) => (
        <Polygon key={pts(tri)} points={pts(tri)} fill={shade(tri, h)} />
      ))}
    </G>
  );
}

function Shatter({ t, hover, press }: Frame) {
  const sec = t / 1000;
  const burst = press >= 0 ? Math.sin(Math.PI * press) * (1 - press * 0.4) : 0;
  const h = (p: P) => hover * Math.sin(p[0] * 0.8 + p[1] * 0.5 + sec * 6) * 0.6;
  const k = Math.max(hover, burst > 0 ? 1 : 0);
  return (
    <G opacity={Math.min(1, k * 1.4)}>
      {TRIS.map((tri) => {
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3 - C[0];
        const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3 - C[1];
        const f = burst * 0.32;
        return (
          <Polygon
            key={pts(tri)}
            points={pts(tri, cx * f, cy * f)}
            fill={shade(tri, h, burst * 0.25)}
            stroke={color.bg}
            strokeWidth={burst * 0.5}
          />
        );
      })}
    </G>
  );
}

function Sweep({ t, hover, press, big }: Frame & { big: boolean }) {
  const sec = t / 1000;
  // Band runs top-left to bottom-right along x + y, once every 700ms while hovered.
  const band = ((sec / 0.7) % 1) * 64 - 10;
  const flash = press >= 0 ? 1 - ease(press) : 0;
  const near = (p: P) => Math.exp(-((p[0] + p[1] - band) ** 2) * 0.02) * hover;
  const h = (p: P) => near(p) * 1.4;
  const reach = press >= 0 ? ease(press) * 4 : 0;
  return (
    <G>
      <G opacity={Math.min(1, hover * 1.4)}>
        {TRIS.map((tri) => (
          <Polygon
            key={pts(tri)}
            points={pts(tri)}
            fill={shade(tri, h, near(mid(tri[0], tri[1])) * 0.5)}
          />
        ))}
      </G>
      {SEGS.map(([a, b]) => (
        <Line
          key={`${a.join()}-${b.join()}`}
          x1={a[0]}
          y1={a[1]}
          x2={b[0]}
          y2={b[1]}
          stroke={color.cyan2}
          strokeWidth={0.35}
          opacity={Math.min(0.9, near(mid(a, b)) * 0.9 + flash * 0.7)}
        />
      ))}
      {VERTS.map((p) => (
        <Circle
          key={p.join()}
          cx={p[0]}
          cy={p[1]}
          r={0.55 + flash * 0.5}
          fill={color.mint}
          opacity={Math.min(1, near(p) * 1.2 + flash)}
        />
      ))}
      {big &&
        flash > 0 &&
        OUTER.map((o) => {
          const dx = (o[0] - C[0]) / 11;
          const dy = (o[1] - C[1]) / 11;
          return (
            <Line
              key={`x${o.join()}`}
              x1={o[0]}
              y1={o[1]}
              x2={o[0] + dx * reach}
              y2={o[1] + dy * reach}
              stroke={color.cyan}
              strokeWidth={0.4}
              opacity={flash}
            />
          );
        })}
    </G>
  );
}

const s = StyleSheet.create({
  box: { position: "relative" },
  svg: { position: "absolute" },
});
