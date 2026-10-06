import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { FloatingProps } from "./Floating";

export type { FloatingProps } from "./Floating";

const EDGE = 8;

interface Box {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
}

interface Measurable {
  getBoundingClientRect?: () => DOMRect;
}

/**
 * Inline popups (slash menu, wide-web Select) rendered into document.body with fixed
 * positioning, so no ancestor's overflow, clip-path or stacking context can cut them off.
 * Tracks the anchor through scroll and resize, flips to the side with more room and clamps
 * to the viewport.
 */
export function Floating({ anchor, up = false, right, width, gap = 4, children }: FloatingProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [h, setH] = useState(0);
  const measure = useCallback(() => {
    const el = anchor.current as unknown as Measurable | null;
    const r = el?.getBoundingClientRect?.();
    if (!r) return;
    setRect((p) =>
      p && p.top === r.top && p.left === r.left && p.width === r.width && p.height === r.height
        ? p
        : r,
    );
  }, [anchor]);
  const raf = useRef(0);
  useLayoutEffect(() => {
    measure();
    const on = () => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    const el = anchor.current as unknown as Element | null;
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(on) : null;
    if (ro && el) ro.observe(el);
    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("resize", on);
      ro?.disconnect();
    };
  }, [anchor, measure]);
  const onLayout = useCallback((e: LayoutChangeEvent) => setH(e.nativeEvent.layout.height), []);
  const placed = useMemo(() => {
    if (!rect) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(width ?? rect.width, vw - EDGE * 2);
    const left = Math.max(EDGE, Math.min(vw - w - EDGE, right ? rect.right - w : rect.left));
    const above = rect.top - gap - EDGE;
    const below = vh - rect.bottom - gap - EDGE;
    const need = h || 160;
    let isUp = up;
    if (up && above < need && below > above) isUp = false;
    if (!up && below < need && above > below) isUp = true;
    const room = Math.max(80, isUp ? above : below);
    const box: Box = isUp
      ? { bottom: vh - rect.top + gap, left, width: w }
      : { top: rect.bottom + gap, left, width: w };
    return { box, up: isUp, maxHeight: room };
  }, [rect, width, right, gap, up, h]);
  if (!placed || typeof document === "undefined") return null;
  return createPortal(
    <View style={[s.layer, placed.box]} onLayout={onLayout}>
      {children({ up: placed.up, maxHeight: placed.maxHeight })}
    </View>,
    document.body,
  );
}

const s = StyleSheet.create({
  layer: { position: "fixed" as "absolute", zIndex: 1000 },
});
