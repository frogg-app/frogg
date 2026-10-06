import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  type EasingFunction,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { glide } from "../theme/tokens";
import { useReducedMotion } from "./Meter";
import { T } from "./Text";

const glideCurve = Easing.bezier(...glide.curve);

export interface CountUpOptions {
  /** Lerp length in ms. Match the fill the number accompanies. */
  duration?: number;
  /** Wait before counting, e.g. until the first segment lands. */
  delay?: number;
  /** Defaults to the `glide` curve. Use `Easing.linear` to track a linear stagger. */
  curve?: EasingFunction;
}

/**
 * A number that lerps toward `value`: 0 → n on mount, old → new on change (from wherever it is
 * mid-flight). JS-driven Animated listener, so it updates once per frame on web and Android.
 * Instant under reduced motion.
 */
export function useCountUp(value: number, opts: CountUpOptions = {}): number {
  const { duration = glide.ms, delay = 0, curve = glideCurve } = opts;
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = v.addListener(({ value: n }) => setShown(n));
    return () => v.removeListener(id);
  }, [v]);
  useEffect(() => {
    if (reduced || duration <= 0) {
      v.setValue(value);
      return;
    }
    const a = Animated.timing(v, {
      toValue: value,
      duration,
      delay,
      easing: curve,
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [value, duration, delay, curve, reduced, v]);
  return reduced ? value : shown;
}

/** Formatters that stay correct mid-lerp (they round the in-between value themselves). */
export const fmt = {
  pct: (n: number) => `${Math.round(n)}%`,
  int: (n: number) => Math.round(n).toLocaleString("en-US"),
  tokens: (n: number) => {
    const a = Math.abs(n);
    if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
    return String(Math.round(n));
  },
  cost: (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
} as const;

/**
 * A counting label. `style` is a Text style; digits are tabular so the width holds still while
 * the value runs.
 */
export function Num({
  value,
  format = fmt.int,
  style,
  ...opts
}: CountUpOptions & {
  value: number;
  format?: (n: number) => string;
  style?: StyleProp<TextStyle>;
}) {
  const n = useCountUp(value, opts);
  return (
    <T v="mono" style={[s.tab, style]}>
      {format(n)}
    </T>
  );
}

const s = StyleSheet.create({ tab: { fontVariant: ["tabular-nums"] } });
