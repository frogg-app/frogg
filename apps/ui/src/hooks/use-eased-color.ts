import { useEffect, useRef, useState } from "react";
import { mixColor } from "@/styles/color-mix";

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Eases a colour towards `target`, starting from whatever is on screen. A
 * meter crossing its amber threshold mid-transition keeps travelling from the
 * colour it is actually showing rather than snapping back to the tone it left.
 */
export function useEasedColor(target: string, durationMs: number, enabled = true): string {
  const [color, setColor] = useState(target);
  const displayed = useRef(target);
  const frame = useRef<number | null>(null);
  displayed.current = color;

  useEffect(() => {
    if (!enabled || durationMs <= 0 || typeof requestAnimationFrame !== "function") {
      setColor(target);
      return;
    }
    const from = displayed.current;
    if (from === target) return;
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / durationMs);
      setColor(mixColor(from, target, easeOutCubic(t)));
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

  return color;
}
