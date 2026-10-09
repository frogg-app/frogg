import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { color, glide } from "../theme/tokens";
import { fmt, Num } from "./CountUp";
import { T } from "./Text";

const N = 20;
const CELLS = Array.from({ length: N }, (_, n) => ({ id: `c${n}`, n }));
/** Per-cell stagger and per-cell fade/scale on the glide curve: 20 cells land in ~420ms. */
export const meterMotion = { stagger: 16, cellMs: 110, fillMs: 420, pulseMs: 380 } as const;
const curve = Easing.bezier(...glide.curve);
const wave = Easing.inOut(Easing.quad);

export function toneFor(p: number | null): string {
  if (p === null) return color.faint;
  if (p >= 90) return color.coral;
  if (p >= 70) return color.amber;
  return color.cyan;
}

/** Alert level read from the tint, so caller thresholds (device warn/critical settings) drive it. */
export type MeterLevel = "none" | "warn" | "crit";
export function levelOf(tint: string, p: number | null): MeterLevel {
  if (p === null || p <= 0) return "none";
  if (tint === color.coral) return "crit";
  if (tint === color.amber) return "warn";
  return "none";
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (live) setReduced(v);
        return v;
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

const t = (v: Animated.Value, to: number, ms: number, easing = wave) =>
  Animated.timing(v, { toValue: to, duration: ms, easing, useNativeDriver: false });

/**
 * Alert motion after a fill settles. `flash` lights the whole filled run, `sweep` travels
 * 0→1 along it, `lead` pulses the leading edge.
 * Warn: one shimmer sweep, then a faint slow breathe on the lead.
 * Crit: three quick whole-run pulses (~2.6/s), then a persistent lead pulse.
 */
export function useMeterAlert(level: MeterLevel, delay: number, reduced: boolean) {
  const flash = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(-0.4)).current;
  const lead = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    flash.setValue(0);
    sweep.setValue(-0.4);
    lead.setValue(0);
    if (reduced || level === "none") return;
    const p = meterMotion.pulseMs;
    let seq: Animated.CompositeAnimation;
    if (level === "warn") {
      seq = Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          t(sweep, 1.4, 640, Easing.inOut(Easing.cubic)),
          Animated.sequence([t(flash, 0.35, 140), t(flash, 0, 420)]),
        ]),
        Animated.loop(Animated.sequence([t(lead, 0.25, 1300), t(lead, 0, 1300)])),
      ]);
    } else {
      const pulse = Animated.sequence([t(flash, 1, p * 0.4), t(flash, 0, p * 0.6)]);
      seq = Animated.sequence([
        Animated.delay(delay),
        pulse,
        Animated.sequence([t(flash, 1, p * 0.4), t(flash, 0, p * 0.6)]),
        Animated.sequence([t(flash, 1, p * 0.4), t(flash, 0, p * 0.6)]),
        Animated.loop(Animated.sequence([t(lead, 1, 700), t(lead, 0.15, 700)])),
      ]);
    }
    seq.start();
    return () => seq.stop();
  }, [level, delay, reduced, flash, sweep, lead]);
  return { flash, sweep, lead };
}

/** The value a meter is moving from; stable across re-renders until the value changes again. */
export function useFrom(value: number): number {
  const [step, setStep] = useState({ to: value, from: 0 });
  if (step.to !== value) {
    const next = { to: value, from: step.to };
    setStep(next);
    return next.from;
  }
  return step.from;
}

/** Critical: the percentage label dims with each pulse. */
export function useLabelFlash(flash: Animated.Value, level: MeterLevel) {
  return useMemo(
    () =>
      level === "crit"
        ? { opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }) }
        : null,
    [flash, level],
  );
}

function baseOpacity(n: number) {
  return 0.55 + (0.45 * n) / N;
}

function Cell({
  n,
  on,
  delay,
  tint,
  prevTint,
  tone,
  reduced,
  isLead,
  alert,
  count,
  level,
}: {
  n: number;
  on: boolean;
  delay: number;
  tint: string;
  prevTint: string;
  tone: Animated.Value;
  reduced: boolean;
  isLead: boolean;
  alert: ReturnType<typeof useMeterAlert>;
  count: number;
  level: MeterLevel;
}) {
  const v = useRef(new Animated.Value(reduced ? Number(on) : 0)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(Number(on));
      return;
    }
    const a = Animated.timing(v, {
      toValue: Number(on),
      duration: meterMotion.cellMs,
      delay,
      easing: curve,
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [on, delay, reduced, v]);

  const bg = tone.interpolate({ inputRange: [0, 1], outputRange: [prevTint, tint] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0, baseOpacity(n)] });
  const scaleY = v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  // Sweep position along the filled run; each cell lights as the sweep passes it.
  const at = count > 1 ? n / (count - 1) : 0;
  const shine =
    level === "warn"
      ? Animated.add(
          alert.sweep.interpolate({
            inputRange: [at - 0.25, at, at + 0.25],
            outputRange: [0, 0.6, 0],
            extrapolate: "clamp",
          }),
          isLead ? alert.lead : 0,
        )
      : Animated.add(
          alert.flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }),
          isLead ? alert.lead.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] }) : 0,
        );
  const glowStyle = { opacity: on ? Animated.multiply(shine, v) : 0 };
  return (
    <View style={s.cellBox}>
      <View style={s.cellOff} />
      <Animated.View style={[s.fillAbs, { backgroundColor: bg, opacity, transform: [{ scaleY }] }]}>
        <Animated.View style={[s.fillAbs, s.glow, glowStyle]} />
      </Animated.View>
    </View>
  );
}

/** Tracks the tint across renders and crossfades between the old and new one. */
export function useToneFade(tint: string, reduced: boolean) {
  const [pair, setPair] = useState({ prev: tint, cur: tint });
  const tone = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (tint === pair.cur) return;
    setPair({ prev: pair.cur, cur: tint });
    if (reduced) return tone.setValue(1);
    tone.setValue(0);
    const a = t(tone, 1, 240, curve);
    a.start();
    return () => a.stop();
  }, [tint, pair.cur, reduced, tone]);
  return { tone, prevTint: pair.prev };
}

/**
 * A segmented bar: 20 cells, filled cells take the tone colour and brighten toward the end.
 * Cells stagger in on mount and toward new values; ≥ warning gets one shimmer, ≥ critical
 * pulses three times then keeps a leading-cell pulse. Static under reduced motion.
 */
export function Meter({
  pct,
  label,
  detail,
  tone,
}: {
  pct: number | null;
  label: string;
  detail?: string;
  tone?: string;
}) {
  const p = pct === null ? null : Math.max(0, Math.min(100, pct));
  const tint = tone ?? toneFor(p);
  const filled = p === null ? 0 : Math.round(p / 5);
  const reduced = useReducedMotion();
  const level = levelOf(tint, p);
  const from = useFrom(filled);
  const span = Math.abs(filled - from);
  const settle = span * meterMotion.stagger + meterMotion.cellMs;
  const alert = useMeterAlert(level, settle, reduced);
  const fade = useToneFade(tint, reduced);
  const pctStyle = useLabelFlash(alert.flash, level);
  return (
    <View style={s.root}>
      <View style={s.head}>
        <T style={s.label}>{label}</T>
        <Animated.View style={pctStyle}>
          {p === null ? (
            <T v="mono" style={s.pctNone}>
              —
            </T>
          ) : (
            <Num
              value={p}
              format={fmt.pct}
              duration={Math.abs(filled - from) * meterMotion.stagger + meterMotion.cellMs / 3}
              curve={Easing.linear}
              style={[s.pct, level === "crit" && s.pctCrit]}
            />
          )}
        </Animated.View>
      </View>
      <View style={s.bar}>
        {CELLS.map((c) => (
          <Cell
            key={c.id}
            n={c.n}
            on={c.n < filled}
            delay={Math.abs(filled >= from ? c.n - from : from - 1 - c.n) * meterMotion.stagger}
            tint={tint}
            prevTint={fade.prevTint}
            tone={fade.tone}
            reduced={reduced}
            isLead={c.n === filled - 1}
            alert={alert}
            count={filled}
            level={level}
          />
        ))}
      </View>
      {detail && (
        <T v="mono" style={s.detail}>
          {detail}
        </T>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 6 },
  head: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  label: { flex: 1, fontSize: 12.5 },
  pct: { color: color.text, fontSize: 12, minWidth: 32, textAlign: "right" },
  pctCrit: { color: color.coral },
  pctNone: { color: color.faint, fontSize: 12 },
  bar: { flexDirection: "row", gap: 2, height: 6 },
  cellBox: { flex: 1 },
  cellOff: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(255,255,255,0.07)" },
  fillAbs: StyleSheet.absoluteFillObject as ViewStyle,
  glow: { backgroundColor: color.text },
  detail: { fontSize: 10.5, color: color.faint },
});
