import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { overlayMotion, overlayMs, web } from "../theme/tokens";

interface MQ {
  matchMedia?: (q: string) => { matches: boolean };
}

/** True when the user asked the OS for reduced motion (web only; native reports false). */
export function reducedMotion(): boolean {
  const g = globalThis as MQ & { document?: unknown };
  if (!g.document || !g.matchMedia) return false;
  return g.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const animates = () => !!(globalThis as { document?: unknown }).document && !reducedMotion();

/**
 * Keeps an overlay mounted through its exit animation. `mounted` drives the Modal/visibility,
 * `closing` swaps the enter keyframes for the exit ones. On native or with reduced motion the
 * overlay unmounts at once.
 */
export function usePresence(open: boolean, exitMs: number = overlayMs.out) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open && (!mounted || closing)) {
    setMounted(true);
    setClosing(false);
  }
  if (!open && mounted && !closing) {
    if (animates()) setClosing(true);
    else setMounted(false);
  }
  useEffect(() => {
    if (!closing) return undefined;
    const t = setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, exitMs);
    return () => clearTimeout(t);
  }, [closing, exitMs]);
  return { mounted, closing };
}

const none = {};
// RN-web only compiles `animationKeyframes` inside StyleSheet.create, never in inline styles.
const m = StyleSheet.create({
  popDown: overlayMotion.popDown,
  popUp: overlayMotion.popUp,
  popOut: overlayMotion.popOut,
  rise: overlayMotion.rise,
  fadeIn: overlayMotion.fadeIn,
  fadeOut: overlayMotion.fadeOut,
  sheetIn: overlayMotion.sheetIn,
  sheetOut: overlayMotion.sheetOut,
  tl: web({ transformOrigin: "top left" }),
  tr: web({ transformOrigin: "top right" }),
  bl: web({ transformOrigin: "bottom left" }),
  br: web({ transformOrigin: "bottom right" }),
});

function origin(up: boolean, right: boolean) {
  if (up) return right ? m.br : m.bl;
  return right ? m.tr : m.tl;
}

/** Enter/exit style for a popover panel; `up` when it opened above its anchor. */
export function popStyle(closing: boolean, up: boolean, right: boolean): object[] {
  if (!animates()) return [none];
  if (closing) return [m.popOut, origin(up, right)];
  return [up ? m.popUp : m.popDown, origin(up, right)];
}

/** Enter/exit style for a centred dialog/palette panel. */
export function riseStyle(closing: boolean): object {
  if (!animates()) return none;
  return closing ? m.popOut : m.rise;
}

/** Enter/exit style for a backdrop scrim. */
export function scrimStyle(closing: boolean): object {
  if (!animates()) return none;
  return closing ? m.fadeOut : m.fadeIn;
}

/** Enter/exit style for a bottom sheet panel. */
export function sheetStyle(closing: boolean): object {
  if (!animates()) return none;
  return closing ? m.sheetOut : m.sheetIn;
}

/** Non-interactive while exiting, so clicks reach what is underneath. */
export const exitPointer = (closing: boolean) => (closing ? "none" : "auto") as "none" | "auto";
