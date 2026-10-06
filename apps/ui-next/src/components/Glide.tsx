import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  type LayoutChangeEvent,
  type LayoutRectangle,
} from "react-native";
import { glide } from "../theme/tokens";

const curve = Easing.bezier(...glide.curve);

/**
 * One shared selection indicator that slides and resizes between measured items.
 * Items report their layout via `measure(id)`; `style` positions an absolutely placed
 * indicator (left/width/top/height) and is null until the active item is measured.
 * The first placement and reduced motion jump; later changes (selection, resize, counts) glide.
 */
export function useGlide<K extends string>(active: K) {
  const rects = useRef(new Map<K, LayoutRectangle>());
  const [, bump] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const w = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const h = useRef(new Animated.Value(0)).current;
  const placed = useRef(false);
  const reduce = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((r) => {
        if (live) reduce.current = r;
        return r;
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (r) => {
      reduce.current = r;
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const measure = useCallback((id: K, e: LayoutChangeEvent) => {
    const r = e.nativeEvent.layout;
    const old = rects.current.get(id);
    if (old && old.x === r.x && old.width === r.width && old.y === r.y && old.height === r.height)
      return;
    rects.current.set(id, r);
    bump((n) => n + 1);
  }, []);

  const r = rects.current.get(active);
  useEffect(() => {
    if (!r) return;
    const to = [r.x, r.width, r.y, r.height];
    const vals = [x, w, y, h];
    if (!placed.current || reduce.current) {
      vals.forEach((v, i) => v.setValue(to[i]));
      placed.current = true;
      setReady(true);
      return;
    }
    const a = Animated.parallel(
      vals.map((v, i) =>
        Animated.timing(v, {
          toValue: to[i],
          duration: glide.ms,
          easing: curve,
          useNativeDriver: false,
        }),
      ),
    );
    a.start();
    return () => a.stop();
  }, [r, x, w, y, h]);

  return { measure, ready, left: x, width: w, top: y, height: h };
}
