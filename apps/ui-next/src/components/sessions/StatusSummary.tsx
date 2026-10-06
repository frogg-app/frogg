// The session-list status summary: a proportional stacked bar plus a legend of bucket counts.
// Everything moves on RN Animated (JS driver), so web and Android share one implementation.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Platform, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { Bucket } from "../../daemon/types";
import { beamBand, color, font, glide } from "../../theme/tokens";
import { useCountUp } from "../CountUp";
import { useReducedMotion } from "../Meter";
import { bucketColor, StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";

export const BUCKETS: Array<{ b: Bucket; label: string }> = [
  { b: "needs", label: "needs you" },
  { b: "failed", label: "failed" },
  { b: "review", label: "ready to review" },
  { b: "working", label: "working" },
  { b: "idle", label: "idle" },
];

/** Timings (ms). Flash pulses stay under 3/s. */
export const summaryMotion = {
  /** Segment width change on the glide curve. */
  resize: 240,
  /** First mount: the bar wipes in left to right. */
  fill: 420,
  /** Legend count roll per integer step (old out up, new in from below). Counts lerp old→new
   * over `resize` (0→n over `fill` on mount), in step with the segment widths. */
  roll: 140,
  /** Legend item enter / exit. */
  enter: 200,
  exit: 160,
  /** Needs-you bleep: two pulses of up+down (~2.7/s). */
  bleepUp: 150,
  bleepDown: 220,
  /** Failed: one sharp flash. */
  sharpUp: 70,
  sharpDown: 380,
  /** Ready to review: one soft glow. */
  glowUp: 280,
  glowDown: 820,
  /** Glyph pop on increase. */
  popUp: 120,
  popDown: 260,
  /** Needs-you glyph breathe (each half). */
  breathe: 1100,
  /** Working beam travel; working glyph pulse (each half). */
  beam: 1700,
  pulse: 700,
} as const;

const M = summaryMotion;
const curve = Easing.bezier(...glide.curve);
const wave = Easing.inOut(Easing.quad);
const out = Easing.out(Easing.quad);
const GAP = 2;

const tween = (v: Animated.Value, to: number, ms: number, easing = wave) =>
  Animated.timing(v, { toValue: to, duration: ms, easing, useNativeDriver: false });

/** Per-bucket "it went up" signal: a counter that bumps whenever the count rises. */
function useRise(n: number): number {
  const prev = useRef(n);
  const [rise, setRise] = useState(0);
  useEffect(() => {
    if (n > prev.current) setRise((r) => r + 1);
    prev.current = n;
  }, [n]);
  return rise;
}

/** The flash a bucket plays when its count rises; resolves to a timing sequence on `v`. */
function flashFor(b: Bucket, v: Animated.Value): Animated.CompositeAnimation | null {
  switch (b) {
    case "needs":
      return Animated.sequence([
        tween(v, 1, M.bleepUp, out),
        tween(v, 0.1, M.bleepDown),
        tween(v, 1, M.bleepUp, out),
        tween(v, 0, M.bleepDown + 120),
      ]);
    case "failed":
      return Animated.sequence([tween(v, 1, M.sharpUp, out), tween(v, 0, M.sharpDown, out)]);
    case "review":
      return Animated.sequence([tween(v, 0.6, M.glowUp, out), tween(v, 0, M.glowDown)]);
    default:
      return null;
  }
}

function useFlash(b: Bucket, rise: number, reduced: boolean): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!rise || reduced) return;
    const a = flashFor(b, v);
    a?.start();
    return () => a?.stop();
  }, [b, rise, reduced, v]);
  return v;
}

export function StatusSummary({ counts }: { counts: Record<Bucket, number> }) {
  const reduced = useReducedMotion();
  const total = BUCKETS.reduce((n, o) => n + counts[o.b], 0) || 1;
  const [w, setW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width), []);
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!w) return;
    if (reduced) {
      reveal.setValue(1);
      return;
    }
    const a = tween(reveal, 1, M.fill, curve);
    a.start();
    return () => a.stop();
    // Once per mount, after the first measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w > 0, reduced]);
  const clip = useMemo(
    () => [s.clip, { width: reveal.interpolate({ inputRange: [0, 1], outputRange: [0, w] }) }],
    [reveal, w],
  );
  return (
    <View>
      <View style={s.track} onLayout={onLayout}>
        <Animated.View style={clip}>
          <View style={s.row}>
            {BUCKETS.map((o) => (
              <Segment
                key={o.b}
                b={o.b}
                share={counts[o.b] / total}
                n={counts[o.b]}
                span={w + GAP}
                reduced={reduced}
              />
            ))}
          </View>
        </Animated.View>
      </View>
      <View style={s.legend}>
        {BUCKETS.map((o) => (
          <LegendItem key={o.b} b={o.b} label={o.label} n={counts[o.b]} reduced={reduced} />
        ))}
      </View>
    </View>
  );
}

function Segment({
  b,
  share,
  n,
  span,
  reduced,
}: {
  b: Bucket;
  share: number;
  n: number;
  span: number;
  reduced: boolean;
}) {
  const v = useRef(new Animated.Value(share)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(share);
      return;
    }
    const a = tween(v, share, M.resize, curve);
    a.start();
    return () => a.stop();
  }, [share, reduced, v]);
  const flash = useFlash(b, useRise(n), reduced);
  const beam = useRef(new Animated.Value(0)).current;
  const working = b === "working" && n > 0 && !reduced;
  useEffect(() => {
    if (!working) return;
    beam.setValue(0);
    const a = Animated.loop(
      Animated.sequence([tween(beam, 1, M.beam, Easing.inOut(Easing.sin)), Animated.delay(240)]),
    );
    a.start();
    return () => a.stop();
  }, [working, beam]);
  const outer = useMemo(
    () => [s.seg, { width: v.interpolate({ inputRange: [0, 1], outputRange: [0, span] }) }],
    [v, span],
  );
  const fill = useMemo(() => [s.fill, { backgroundColor: bucketColor[b] }], [b]);
  const flashSt = useMemo(
    () => [s.flash, { opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }) }],
    [flash],
  );
  const beamSt = useMemo(
    () => [
      s.beam,
      {
        left: beam.interpolate({ inputRange: [0, 1], outputRange: ["-45%", "100%"] }),
        opacity: beam.interpolate({ inputRange: [0, 0.15, 0.85, 1], outputRange: [0, 1, 1, 0] }),
      },
    ],
    [beam],
  );
  return (
    <Animated.View style={outer}>
      <View style={fill}>
        {working && <Animated.View style={beamSt} />}
        <Animated.View style={flashSt} />
      </View>
    </Animated.View>
  );
}

function LegendItem({
  b,
  label,
  n,
  reduced,
}: {
  b: Bucket;
  label: string;
  n: number;
  reduced: boolean;
}) {
  const [shown, setShown] = useState(n > 0);
  const presence = useRef(new Animated.Value(n > 0 ? 1 : 0)).current;
  useEffect(() => {
    if (n > 0) {
      setShown(true);
      if (reduced) presence.setValue(1);
      else tween(presence, 1, M.enter, curve).start();
      return;
    }
    if (reduced) {
      presence.setValue(0);
      setShown(false);
      return;
    }
    const a = tween(presence, 0, M.exit, out);
    a.start(({ finished }) => finished && setShown(false));
    return () => a.stop();
  }, [n > 0, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  const rise = useRise(n);
  const flash = useFlash(b, rise, reduced);
  const pop = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!rise || reduced || b === "idle" || b === "working") return;
    const a = Animated.sequence([tween(pop, 1.7, M.popUp, out), tween(pop, 1, M.popDown, curve)]);
    a.start();
    return () => a.stop();
  }, [rise, reduced, b, pop]);

  // Persistent: needs-you breathes while anything waits; working pulses while anything runs.
  const idleLoop = useRef(new Animated.Value(1)).current;
  const looping = n > 0 && !reduced && (b === "needs" || b === "working");
  useEffect(() => {
    idleLoop.setValue(1);
    if (!looping) return;
    const half = b === "needs" ? M.breathe : M.pulse;
    const low = b === "needs" ? 0.45 : 0.4;
    const a = Animated.loop(
      Animated.sequence([tween(idleLoop, low, half), tween(idleLoop, 1, half)]),
    );
    a.start();
    return () => a.stop();
  }, [looping, b, idleLoop]);

  const item = useMemo(
    () => [
      s.item,
      {
        opacity: presence,
        transform: [
          { translateY: presence.interpolate({ inputRange: [0, 1], outputRange: [3, 0] }) },
        ],
      },
    ],
    [presence],
  );
  const wash = useMemo(
    () => [
      s.wash,
      {
        backgroundColor: bucketColor[b],
        opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.24] }),
      },
    ],
    [b, flash],
  );
  const glyph = useMemo(
    () => [s.glyph, { opacity: idleLoop, transform: [{ scale: pop }] }],
    [idleLoop, pop],
  );
  if (!shown) return null;
  return (
    <Animated.View style={item}>
      <Animated.View style={wash} pointerEvents="none" />
      <Animated.View style={glyph}>
        <StatusGlyph bucket={b} size={7} still />
      </Animated.View>
      <RollingCount n={n} reduced={reduced} />
      <T style={s.label} numberOfLines={1}>
        {label}
      </T>
    </Animated.View>
  );
}

/** The integer shown while `target` lerps old→new on the bar's curve; 0→target on mount. */
function useLerp(target: number): number {
  const first = useRef(true);
  useEffect(() => {
    first.current = false;
  }, []);
  return Math.round(useCountUp(target, { duration: first.current ? M.fill : M.resize, curve }));
}

/** A number that rolls: the old value slides up and out while the new one rises in. */
function RollingCount({ n, reduced }: { n: number; reduced: boolean }) {
  // On exit (n → 0) keep showing the last non-zero count while the item fades.
  const shownN = useRef(n);
  if (n > 0) shownN.current = n;
  const value = useLerp(n > 0 ? n : shownN.current);
  const [pair, setPair] = useState({ now: value, was: value, dir: 1 });
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (value === pair.now) return;
    setPair({ now: value, was: pair.now, dir: value > pair.now ? 1 : -1 });
    if (reduced) return;
    t.setValue(0);
    tween(t, 1, M.roll, curve).start();
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = pair.dir * 8;
  const inSt = useMemo(
    () => [
      s.num,
      {
        opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [d, 0] }) }],
      },
    ],
    [t, d],
  );
  const outSt = useMemo(
    () => [
      s.num,
      s.numOld,
      {
        opacity: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 0, 0] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -d] }) }],
      },
    ],
    [t, d],
  );
  return (
    <View style={s.roll}>
      <Animated.Text style={inSt}>{pair.now}</Animated.Text>
      {pair.was !== pair.now && !reduced && (
        <Animated.Text style={outSt} pointerEvents="none">
          {pair.was}
        </Animated.Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  track: { marginHorizontal: 14, height: 3, backgroundColor: color.line, overflow: "hidden" },
  clip: { height: 3, overflow: "hidden" },
  row: { flexDirection: "row", height: 3 },
  seg: { height: 3, overflow: "hidden" },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    right: GAP,
    overflow: "hidden",
  },
  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: color.text },
  beam: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: "45%",
    ...Platform.select({
      web: beamBand,
      default: { backgroundColor: color.cyan2 },
    }),
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  item: { flexDirection: "row", alignItems: "center", gap: 5, flexShrink: 0 },
  wash: { position: "absolute", left: -4, right: -4, top: -2, bottom: -2 },
  glyph: { width: 10, alignItems: "center", justifyContent: "center", marginRight: -3 },
  roll: { overflow: "hidden", height: 16, justifyContent: "center" },
  num: {
    fontFamily: font.body,
    fontSize: 11.5,
    fontWeight: "600",
    color: color.text,
    lineHeight: 16,
  },
  numOld: { position: "absolute", left: 0, top: 0 },
  label: { fontSize: 11.5, color: color.muted },
});
