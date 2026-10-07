import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
  type EasingFunction,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { glide } from "../theme/tokens";

/**
 * Native equivalents of the CSS keyframe motion in theme/tokens.ts (`anim()` is a no-op off-web).
 * Everything here runs on the native driver. On web these components render a plain View, so the
 * existing CSS style on the same node keeps doing the work.
 */
export const isNative = Platform.OS !== "web";

export const nativeEase = {
  /** The `ease` / glide curve. */
  out: Easing.bezier(...glide.curve),
  /** Accelerating exit curve. */
  exit: Easing.bezier(0.4, 0, 1, 1),
  /** Beam travel curve. */
  inOut: Easing.bezier(0.45, 0, 0.55, 1),
  linear: Easing.linear,
};

let reduced = false;
let watching = false;
function watch(): void {
  if (!isNative || watching) return;
  watching = true;
  void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
    reduced = v;
    return v;
  });
  AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => {
    reduced = v;
  });
}

/** Sync read of "may native motion play" (false on web and when the OS asks for reduced motion). */
export function nativeMotionOn(): boolean {
  watch();
  return isNative && !reduced;
}

/** True when the OS asks for reduced motion (native only; web callers use matchMedia). */
export function useReduceMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (!isNative) return undefined;
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => live && setR(v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setR);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return r;
}

/** Where a value starts (or ends, for exits); unset fields stay at rest. */
export interface Pose {
  opacity?: number;
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
}

const REST: Required<Pose> = { opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1 };
const AXIS: Partial<Record<string, string>> = { x: "translateX", y: "translateY" };
const KEYS = ["opacity", "x", "y", "scale", "scaleX", "scaleY"] as const;

interface EnterProps {
  /** Pose at mount; animates to rest. */
  from: Pose;
  /** Pose to animate to while `leaving` (defaults to `from`). */
  exit?: Pose;
  leaving?: boolean;
  /** False renders at rest with no motion. */
  on?: boolean;
  ms?: number;
  exitMs?: number;
  delay?: number;
  easing?: EasingFunction;
  exitEasing?: EasingFunction;
  /** Scale about the leading edge instead of the centre. */
  anchor?: "start-x" | "start-y";
  style?: StyleProp<ViewStyle>;
  pointerEvents?: "none" | "auto" | "box-none";
  children?: ReactNode;
}

/**
 * Animates from `from` to rest on mount (and to `exit` when `leaving`). One 0 to 1 to 2 value
 * drives every property through interpolation, so it is a single native-driver animation.
 */
export function NativeEnter(props: EnterProps) {
  if (!isNative) {
    return (
      <View style={props.style} pointerEvents={props.pointerEvents}>
        {props.children}
      </View>
    );
  }
  return <EnterNative {...props} />;
}

function EnterNative({
  from,
  exit,
  leaving,
  on = true,
  ms = 200,
  exitMs = 140,
  delay = 0,
  easing = nativeEase.out,
  exitEasing = nativeEase.exit,
  anchor,
  style,
  pointerEvents,
  children,
}: EnterProps) {
  const go = on && nativeMotionOn();
  const v = useRef(new Animated.Value(go ? 0 : 1)).current;
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!go) return undefined;
    const a = Animated.timing(v, {
      toValue: 1,
      duration: ms,
      delay,
      easing,
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [go, v, ms, delay, easing]);
  useEffect(() => {
    if (!leaving || !go) return;
    Animated.timing(v, {
      toValue: 2,
      duration: exitMs,
      easing: exitEasing,
      useNativeDriver: true,
    }).start();
  }, [leaving, go, v, exitMs, exitEasing]);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize((p) => (p.w === w && p.h === h ? p : { w, h }));
  }, []);
  const anim = useMemo(() => {
    const to = exit ?? from;
    const out = (k: (typeof KEYS)[number]) =>
      v.interpolate({
        inputRange: [0, 1, 2],
        outputRange: [from[k] ?? REST[k], REST[k], to[k] ?? REST[k]],
      });
    const used = KEYS.filter(
      (k) => (from[k] ?? REST[k]) !== REST[k] || (to[k] ?? REST[k]) !== REST[k],
    );
    const transform: Record<string, Animated.AnimatedInterpolation<number>>[] = [];
    for (const k of used) {
      if (k === "opacity") continue;
      transform.push({ [AXIS[k] ?? k]: out(k) });
    }
    // Scaling about the leading edge: shift by half the lost size.
    if (anchor === "start-x" && size.w) {
      const half = size.w / 2;
      transform.push({
        translateX: v.interpolate({
          inputRange: [0, 1, 2],
          outputRange: [
            ((from.scaleX ?? 1) - 1) * half,
            0,
            (((exit ?? from).scaleX ?? 1) - 1) * half,
          ],
        }),
      });
    }
    if (anchor === "start-y" && size.h) {
      const half = size.h / 2;
      transform.push({
        translateY: v.interpolate({
          inputRange: [0, 1, 2],
          outputRange: [
            ((from.scaleY ?? 1) - 1) * half,
            0,
            (((exit ?? from).scaleY ?? 1) - 1) * half,
          ],
        }),
      });
    }
    const res = used.includes("opacity") ? { opacity: out("opacity"), transform } : { transform };
    return res as unknown as Animated.WithAnimatedObject<ViewStyle>;
  }, [v, from, exit, anchor, size.w, size.h]);
  return (
    <Animated.View style={[style, anim]} pointerEvents={pointerEvents} onLayout={onLayout}>
      {children}
    </Animated.View>
  );
}

/** A 0 to 1 value that loops while `on`, native-driven. */
export function useLoop(ms: number, on = true, easing: EasingFunction = nativeEase.linear) {
  const v = useRef(new Animated.Value(0)).current;
  const run = on && nativeMotionOn();
  useEffect(() => {
    if (!run) return undefined;
    v.setValue(0);
    const a = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: ms, easing, useNativeDriver: true }),
    );
    a.start();
    return () => a.stop();
  }, [run, v, ms, easing]);
  return v;
}

const BAND = 0.25;

/**
 * Soft light band travelling across its parent (which should clip): the native `frames.beam`.
 * Fills the parent absolutely; renders nothing on web.
 */
export function Beam({
  color,
  ms = 1400,
  easing = nativeEase.inOut,
  on = true,
}: {
  color: string;
  ms?: number;
  easing?: EasingFunction;
  on?: boolean;
}) {
  const v = useLoop(ms, on && isNative, easing);
  const [w, setW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width), []);
  const bw = w * BAND;
  const move = useMemo(
    () => ({
      width: bw,
      transform: [
        { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-bw, 4 * bw] }) },
      ],
    }),
    [v, bw],
  );
  if (!isNative) return null;
  const id = `nmb${color.replace("#", "")}`;
  return (
    <View style={s.fill} pointerEvents="none" onLayout={onLayout}>
      {w > 0 && (
        <Animated.View style={[s.band, move]}>
          <Svg width="100%" height="100%" preserveAspectRatio="none">
            <Defs>
              <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={color} stopOpacity={0} />
                <Stop offset="0.5" stopColor={color} stopOpacity={1} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
          </Svg>
        </Animated.View>
      )}
    </View>
  );
}

/** A band that crosses its (clipping) parent once, left to right, fading in and out. */
export function Sweep({
  children,
  ms,
  delay = 0,
  style,
}: {
  children?: ReactNode;
  ms: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!nativeMotionOn()) return undefined;
    const a = Animated.timing(v, {
      toValue: 1,
      duration: ms,
      delay,
      easing: nativeEase.out,
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [v, ms, delay]);
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width), []);
  const move = useMemo(
    () => ({
      width: w * 0.4,
      opacity: v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] }),
      transform: [
        { translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-0.4 * w, w] }) },
      ],
    }),
    [v, w],
  );
  if (!isNative) return null;
  return (
    <View style={s.fill} pointerEvents="none" onLayout={onLayout}>
      <Animated.View style={[style, move]}>{children}</Animated.View>
    </View>
  );
}

/**
 * A line that drains left to right (scaleX 1 to 0, anchored left) over `ms`, holding while
 * `paused` and resuming with the time that is left.
 */
export function NativeDrain({
  ms,
  paused,
  style,
}: {
  ms: number;
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = useRef(new Animated.Value(0)).current;
  const cur = useRef(0);
  const [w, setW] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width), []);
  useEffect(() => {
    const id = p.addListener(({ value }) => {
      cur.current = value;
    });
    return () => p.removeListener(id);
  }, [p]);
  useEffect(() => {
    if (paused || !nativeMotionOn()) return undefined;
    const a = Animated.timing(p, {
      toValue: 1,
      duration: ms * (1 - cur.current),
      easing: nativeEase.linear,
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [paused, p, ms]);
  const move = useMemo(
    () => ({
      transform: [
        { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, -w / 2] }) },
        { scaleX: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
      ],
    }),
    [p, w],
  );
  return <Animated.View pointerEvents="none" onLayout={onLayout} style={[style, move]} />;
}

/**
 * Full-size coloured overlay whose opacity pulses once: up to `peak` over `rise` ms (0 starts at
 * the peak), then back to nothing by `ms`. Stands in for CSS background/box-shadow flashes.
 */
export function NativePulse({
  peak,
  ms,
  rise = 0,
  delay = 0,
  style,
}: {
  peak: number;
  ms: number;
  rise?: number;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(rise ? 0 : peak)).current;
  const fade = useMemo(() => ({ opacity: v }), [v]);
  useEffect(() => {
    if (!nativeMotionOn()) {
      v.setValue(0);
      return undefined;
    }
    const down = Animated.timing(v, {
      toValue: 0,
      duration: ms - rise,
      easing: nativeEase.linear,
      useNativeDriver: true,
    });
    const a = Animated.sequence([
      Animated.delay(delay),
      rise
        ? Animated.timing(v, {
            toValue: peak,
            duration: rise,
            easing: nativeEase.out,
            useNativeDriver: true,
          })
        : Animated.delay(0),
      down,
    ]);
    a.start();
    return () => a.stop();
  }, [v, peak, ms, rise, delay]);
  if (!isNative) return null;
  return <Animated.View pointerEvents="none" style={[s.fill, style, fade]} />;
}

const s = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  band: { position: "absolute", top: 0, bottom: 0, left: 0 },
});
