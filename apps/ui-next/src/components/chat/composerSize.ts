import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, PanResponder, useWindowDimensions } from "react-native";
import { create } from "zustand";
import { glide } from "../../theme/tokens";
import { useReducedMotion } from "../Meter";

/**
 * How tall the composer's input is, per session: `auto` grows with the text up to a cap,
 * `expanded` is the big editor, a number is a height the user dragged to.
 */
export type ComposerSize = "auto" | "expanded" | number;

const KEY = "ui-next.composer.size";
/** Sessions remembered; the oldest choices drop off past this. */
const KEEP = 100;

export const useComposerSizes = create<{ sizes: Record<string, ComposerSize> }>(() => ({
  sizes: {},
}));

void AsyncStorage.getItem(KEY)
  .then((raw) => {
    if (raw) useComposerSizes.setState({ sizes: JSON.parse(raw) as Record<string, ComposerSize> });
    return raw;
  })
  .catch(() => undefined);

export function setComposerSize(key: string, size: ComposerSize): void {
  useComposerSizes.setState((s) => {
    const sizes = { ...s.sizes };
    delete sizes[key];
    if (size !== "auto") sizes[key] = size;
    const keys = Object.keys(sizes);
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete sizes[k];
    void AsyncStorage.setItem(KEY, JSON.stringify(sizes)).catch(() => undefined);
    return { sizes };
  });
}

/** Lines the input grows through on its own before it scrolls. */
export const AUTO_LINES = 9;
export const LINE = 20;

export interface Bounds {
  min: number;
  /** Where auto growth stops. */
  auto: number;
  /** The expanded editor's height. */
  expanded: number;
  /** The tallest a drag can make it. */
  max: number;
}

export function bounds(min: number, windowH: number): Bounds {
  const max = Math.max(min + LINE * 4, Math.round(windowH * 0.7));
  const expanded = Math.min(max, Math.max(LINE * 12, Math.round(windowH * 0.5)));
  return { min, auto: Math.min(min + LINE * (AUTO_LINES - 2), expanded), expanded, max };
}

/** The height a size asks for, given the text's own height. */
export function targetHeight(size: ComposerSize, content: number, b: Bounds): number {
  if (size === "expanded") return b.expanded;
  if (typeof size === "number") return Math.min(b.max, Math.max(b.min, size));
  return Math.min(b.auto, Math.max(b.min, Math.ceil(content)));
}

/** A drag that ends this close to the auto height snaps back to auto. */
const SNAP = 12;

/**
 * The input's animated height: follows the text in auto, glides between sizes on the motion
 * curve, tracks a drag on the grip 1:1 and remembers the result per `sizeKey`.
 */
export function useComposerHeight(sizeKey: string | undefined, min: number) {
  const win = useWindowDimensions();
  const b = bounds(min, win.height);
  const stored = useComposerSizes((s) => (sizeKey ? s.sizes[sizeKey] : undefined));
  const [local, setLocal] = useState<ComposerSize>("auto");
  const size = sizeKey ? (stored ?? "auto") : local;
  const setSize = useCallback(
    (next: ComposerSize) => (sizeKey ? setComposerSize(sizeKey, next) : setLocal(next)),
    [sizeKey],
  );
  const [content, setContent] = useState(min);
  const target = targetHeight(size, content, b);
  const reduced = useReducedMotion();
  const h = useRef(new Animated.Value(target)).current;
  const dragging = useRef(false);
  const [held, setHeld] = useState(false);
  const placed = useRef(false);
  useEffect(() => {
    if (dragging.current) return;
    if (reduced || !placed.current) {
      placed.current = true;
      h.setValue(target);
      return;
    }
    const a = Animated.timing(h, {
      toValue: target,
      duration: glide.ms,
      easing: Easing.bezier(...glide.curve),
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [h, target, reduced]);

  // Grip drag: up grows, down shrinks; release keeps the height, or snaps to auto near it.
  const live = useRef({ b, content, target, setSize });
  live.current = { b, content, target, setSize };
  const start = useRef(0);
  const grip = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragging.current = true;
        setHeld(true);
        start.current = live.current.target;
      },
      onPanResponderMove: (_, g) => {
        const { b: lim } = live.current;
        h.setValue(Math.min(lim.max, Math.max(lim.min, start.current - g.dy)));
      },
      onPanResponderRelease: (_, g) => {
        dragging.current = false;
        setHeld(false);
        const { b: lim, content: c, setSize: set } = live.current;
        const end = Math.min(lim.max, Math.max(lim.min, start.current - g.dy));
        const auto = targetHeight("auto", c, lim);
        set(Math.abs(end - auto) <= SNAP ? "auto" : Math.round(end));
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
        setHeld(false);
        h.setValue(live.current.target);
      },
    }),
  ).current;

  const expanded = size !== "auto";
  const toggle = useCallback(() => setSize(expanded ? "auto" : "expanded"), [expanded, setSize]);
  return { height: h, setContent, grip: grip.panHandlers, dragging: held, expanded, toggle };
}
