import { useEffect, useRef, useState } from "react";

/** Decelerating, so the value lands quickly and settles rather than creeping in. */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Eases a plain number towards `target` over `durationMs`, re-rendering each
 * frame. For values driving a handful of SVG attributes — a meter's arc, its
 * colour mix — this is cheaper to reason about than an animated-props bridge,
 * and it behaves the same on web and native.
 *
 * The first value is adopted outright: a meter appearing with a number already
 * in it should draw that number, not sweep up to it from zero.
 */
export function useEasedValue(target: number, durationMs: number, enabled = true): number {
  const [value, setValue] = useState(target);
  const frame = useRef<number | null>(null);
  const current = useRef(target);
  current.current = value;

  useEffect(() => {
    if (!enabled || durationMs <= 0 || typeof requestAnimationFrame !== "function") {
      setValue(target);
      return;
    }
    const from = current.current;
    if (from === target) return;
    const start = Date.now();
    const step = () => {
      const elapsed = Date.now() - start;
      const t = Math.min(1, elapsed / durationMs);
      setValue(from + (target - from) * easeOutCubic(t));
      frame.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) {
        cancelAnimationFrame(frame.current);
        frame.current = null;
      }
    };
  }, [durationMs, enabled, target]);

  return value;
}
