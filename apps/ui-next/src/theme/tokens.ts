// Bracket + Rail tokens. Colours come from the active theme (themes.ts), resolved once at load.
import { readStoredTheme } from "./stored";
import { alpha, resolveTheme } from "./themes";

export { alpha, rgbOf } from "./themes";

/** The active theme, resolved from the stored choice before any stylesheet reads a token. */
export const activeTheme = resolveTheme(readStoredTheme());

export const color = activeTheme.color;

export const font = {
  body: "Inter",
  display: "Space Grotesk",
  mono: "JetBrains Mono",
} as const;

export const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
/** Sliding selection indicators (tabs, segments): the `ease` curve as numbers, and its duration. */
export const glide = { ms: 200, curve: [0.22, 1, 0.36, 1] as const };

/** Width breakpoints: phone below `tablet`, rail + one pane below `desktop`, full IDE above. */
export const bp = { tablet: 700, desktop: 1100 } as const;

/** CSS-only style keys (gradients, outline, resize) that RN types do not know; dropped on native. */
export const web = (style: Record<string, string | number>): object =>
  (globalThis as { document?: unknown }).document ? style : {};

/** Syntax colours for the active theme. */
export const syntax: Record<string, string> = activeTheme.syntax;

/** ANSI colours for the terminal beyond the ones it takes from `color`. */
export const terminalColors = activeTheme.terminal;

type Frames = Record<string, Record<string, string | number>>;

/** Keyframes RN-web turns into CSS @keyframes (it rejects `animation` and `animationName`). */
export const frames = {
  breathe: {
    "0%": { opacity: 0.45 },
    "50%": { opacity: 1 },
    "100%": { opacity: 0.45 },
  },
  snap: {
    "0%": { opacity: 0, transform: "scale(1.06)" },
    "100%": { opacity: 1, transform: "scale(1)" },
  },
  enter: {
    "0%": { opacity: 0, transform: "translateY(6px)" },
    "100%": { opacity: 1, transform: "translateY(0px)" },
  },
  fade: { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
  shimmer: {
    "0%": { backgroundPosition: "200% 0" },
    "100%": { backgroundPosition: "-200% 0" },
  },
  beam: {
    "0%": { transform: "translateX(-100%)" },
    "100%": { transform: "translateX(400%)" },
  },
  afterglow: {
    "0%": { backgroundColor: alpha(color.mint, 0.28) },
    "100%": { backgroundColor: alpha(color.mint, 0.09) },
  },
} satisfies Record<string, Frames>;

export function anim(
  kf: Frames,
  duration: string,
  timing = "cubic-bezier(0.23, 1, 0.32, 1)",
  count: number | "infinite" = 1,
  fill = "both",
): object {
  if (!(globalThis as { document?: unknown }).document) return {};
  return {
    animationKeyframes: kf,
    animationDuration: duration,
    animationTimingFunction: timing,
    animationIterationCount: count,
    animationFillMode: fill,
  };
}

/** Web-only animations; keyframes live in web-fonts.ts. Native gets nothing (static state). */
export const motion = {
  breathe: anim(frames.breathe, "1.6s", "ease-in-out", "infinite"),
  snap: anim(frames.snap, "220ms"),
  enter: anim(frames.enter, "200ms"),
  fade: anim(frames.fade, "150ms", "ease-out"),
  afterglow: anim(frames.afterglow, "1.2s", "ease-out"),
  shimmerText: web({
    backgroundImage: `linear-gradient(90deg, ${color.faint} 0%, ${color.faint} 35%, ${color.cyan2} 50%, ${color.faint} 65%, ${color.faint} 100%)`,
    backgroundSize: "200% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  }),
  shimmerRun: anim(frames.shimmer, "2s", "linear", "infinite", "none"),
};

/** Workspace label colours (protocol WORKSPACE_LABEL_COLORS), tuned for the dark surface. */
export const labelTint: Record<string, string> = activeTheme.labelTint;

/**
 * Overlay motion (menus, popovers, dialogs, palette, sheets): fast scale+fade in on `ease`,
 * a faster accelerating fade+scale out. Web-only CSS keyframes; native gets static styles.
 */
export const overlayMs = { in: 160, out: 110, sheet: 200 } as const;
const easeOut = "cubic-bezier(0.4, 0, 1, 1)";
export const overlayFrames = {
  popDown: {
    "0%": { opacity: 0, transform: "translateY(-4px) scale(0.96)" },
    "100%": { opacity: 1, transform: "translateY(0px) scale(1)" },
  },
  popUp: {
    "0%": { opacity: 0, transform: "translateY(4px) scale(0.96)" },
    "100%": { opacity: 1, transform: "translateY(0px) scale(1)" },
  },
  popOut: {
    "0%": { opacity: 1, transform: "scale(1)" },
    "100%": { opacity: 0, transform: "scale(0.97)" },
  },
  rise: {
    "0%": { opacity: 0, transform: "translateY(6px) scale(0.97)" },
    "100%": { opacity: 1, transform: "translateY(0px) scale(1)" },
  },
  fadeOut: { "0%": { opacity: 1 }, "100%": { opacity: 0 } },
  sheetIn: {
    "0%": { transform: "translateY(100%)" },
    "100%": { transform: "translateY(0%)" },
  },
  sheetOut: {
    "0%": { transform: "translateY(0%)" },
    "100%": { transform: "translateY(100%)" },
  },
} satisfies Record<string, Frames>;
export const overlayMotion = {
  popDown: anim(overlayFrames.popDown, `${overlayMs.in}ms`, ease),
  popUp: anim(overlayFrames.popUp, `${overlayMs.in}ms`, ease),
  popOut: anim(overlayFrames.popOut, `${overlayMs.out}ms`, easeOut),
  rise: anim(overlayFrames.rise, `${overlayMs.in + 10}ms`, ease),
  fadeIn: anim(frames.fade, `${overlayMs.in}ms`, ease),
  fadeOut: anim(overlayFrames.fadeOut, `${overlayMs.out}ms`, easeOut),
  sheetIn: anim(overlayFrames.sheetIn, `${overlayMs.sheet}ms`, ease),
  sheetOut: anim(overlayFrames.sheetOut, `${overlayMs.out + 30}ms`, easeOut),
};

/**
 * Toast motion: card slides in from the right (up on phones) and fades, its corner marks snap
 * in `cornerDelay` later; exit is a faster accelerating slide/fade; the stack reflows on `glide`.
 * `life` is the auto-dismiss time the drain line runs over.
 */
export const toastMs = { in: 200, out: 140, reflow: 180, cornerDelay: 60, life: 4200 } as const;
export const toastFrames = {
  inSide: {
    "0%": { opacity: 0, transform: "translateX(28px)" },
    "100%": { opacity: 1, transform: "translateX(0px)" },
  },
  inUp: {
    "0%": { opacity: 0, transform: "translateY(18px)" },
    "100%": { opacity: 1, transform: "translateY(0px)" },
  },
  outSide: {
    "0%": { opacity: 1, transform: "translateX(0px)" },
    "100%": { opacity: 0, transform: "translateX(24px)" },
  },
  outDown: {
    "0%": { opacity: 1, transform: "translateY(0px)" },
    "100%": { opacity: 0, transform: "translateY(12px)" },
  },
  corner: {
    "0%": { opacity: 0, transform: "scale(1.9)" },
    "100%": { opacity: 1, transform: "scale(1)" },
  },
  drain: {
    "0%": { transform: "scaleX(1)" },
    "100%": { transform: "scaleX(0)" },
  },
} satisfies Record<string, Frames>;
export const toastMotion = {
  inSide: anim(toastFrames.inSide, `${toastMs.in}ms`, ease),
  inUp: anim(toastFrames.inUp, `${toastMs.in}ms`, ease),
  outSide: anim(toastFrames.outSide, `${toastMs.out}ms`, "cubic-bezier(0.4, 0, 1, 1)"),
  outDown: anim(toastFrames.outDown, `${toastMs.out}ms`, "cubic-bezier(0.4, 0, 1, 1)"),
  corner: {
    ...anim(toastFrames.corner, "160ms", ease),
    ...web({ animationDelay: `${toastMs.cornerDelay}ms` }),
  },
  drain: anim(toastFrames.drain, `${toastMs.life}ms`, "linear"),
};

/**
 * Session state cards (end of timeline): fade + rise on `ease`, the kind trim draws in `trimDelay`
 * later; failed flashes coral once, review glows mint once; the compaction summary unfolds.
 */
export const stateMs = { in: 200, trim: 220, trimDelay: 60, flash: 520, glow: 900, fold: 180 };
export const stateFrames = {
  rise: {
    "0%": { opacity: 0, transform: "translateY(8px)" },
    "100%": { opacity: 1, transform: "translateY(0px)" },
  },
  drawX: { "0%": { transform: "scaleX(0)" }, "100%": { transform: "scaleX(1)" } },
  drawY: { "0%": { transform: "scaleY(0)" }, "100%": { transform: "scaleY(1)" } },
  flash: {
    "0%": { backgroundColor: alpha(color.coral, 0.3) },
    "100%": { backgroundColor: alpha(color.coral, 0) },
  },
  glow: {
    "0%": { boxShadow: `0 0 0px ${alpha(color.mint, 0)}` },
    "35%": { boxShadow: `0 0 22px ${alpha(color.mint, 0.32)}` },
    "100%": { boxShadow: `0 0 0px ${alpha(color.mint, 0)}` },
  },
  unfold: {
    "0%": { opacity: 0, maxHeight: 0 },
    "100%": { opacity: 1, maxHeight: 640 },
  },
  fold: {
    "0%": { opacity: 1, maxHeight: 640 },
    "100%": { opacity: 0, maxHeight: 0 },
  },
} satisfies Record<string, Frames>;
const after = (ms: number) => web({ animationDelay: `${ms}ms` });
export const stateMotion = {
  rise: anim(stateFrames.rise, `${stateMs.in}ms`, ease),
  drawX: { ...anim(stateFrames.drawX, `${stateMs.trim}ms`, ease), ...after(stateMs.trimDelay) },
  drawY: { ...anim(stateFrames.drawY, `${stateMs.trim}ms`, ease), ...after(stateMs.trimDelay) },
  flash: { ...anim(stateFrames.flash, `${stateMs.flash}ms`, "ease-out"), ...after(80) },
  glow: { ...anim(stateFrames.glow, `${stateMs.glow}ms`, "ease-out"), ...after(80) },
  beam: anim(frames.beam, "1.4s", "cubic-bezier(0.45, 0, 0.55, 1)", "infinite", "none"),
  corner: { ...anim(frames.snap, "160ms", ease), ...after(stateMs.trimDelay) },
  unfold: anim(stateFrames.unfold, `${stateMs.fold}ms`, ease),
  fold: anim(stateFrames.fold, `${stateMs.fold - 40}ms`, "cubic-bezier(0.4, 0, 1, 1)"),
};
/** Kind washes for state cards. */
export const stateWash = {
  mint: alpha(color.mint, 0.07),
  coral: alpha(color.coral, 0.08),
  amber: alpha(color.amber, 0.07),
  cyan: alpha(color.cyan, 0.07),
} as const;

/** A soft light band (transparent → bright → transparent) for beams travelling along thin bars. */
export const beamBand = web({
  backgroundImage: `linear-gradient(90deg, ${alpha(color.text, 0)} 0%, ${alpha(color.text, 0.85)} 50%, ${alpha(color.text, 0)} 100%)`,
});

/**
 * Tool call settle (running → completed/failed, live only): the glyph wipes in left→right
 * (draw) with a small scale pop, a faint wash sweeps the row and a 2px edge flashes, all on
 * `ease`, settled by `toolDoneMs.sweep`. Web-only; native and reduced motion get the end state.
 */
export const toolDoneMs = { draw: 220, pop: 260, sweep: 420, throttle: 300 } as const;
export const toolDoneFrames = {
  draw: { "0%": { width: 0 }, "100%": { width: 14 } },
  pop: {
    "0%": { opacity: 0, transform: "scale(0.8)" },
    "55%": { opacity: 1, transform: "scale(1.1)" },
    "100%": { opacity: 1, transform: "scale(1)" },
  },
  sweep: {
    "0%": { opacity: 0, transform: "translateX(-100%)" },
    "30%": { opacity: 1 },
    "100%": { opacity: 0, transform: "translateX(250%)" },
  },
  edge: { "0%": { opacity: 0.9 }, "100%": { opacity: 0 } },
} satisfies Record<string, Frames>;
export const toolDoneMotion = {
  draw: anim(toolDoneFrames.draw, `${toolDoneMs.draw}ms`, ease),
  pop: anim(toolDoneFrames.pop, `${toolDoneMs.pop}ms`, ease),
  sweep: anim(toolDoneFrames.sweep, `${toolDoneMs.sweep}ms`, ease),
  edge: anim(toolDoneFrames.edge, `${toolDoneMs.sweep}ms`, "ease-out"),
};

/**
 * Sub-work indicators (session-row chip, chat strip, nested rows), all RN Animated so web and
 * Android share one implementation. Beam/pulse loops only run while something is running; every
 * one-shot is under 3 flashes a second and skipped under reduced motion.
 */
export const subworkMs = {
  /** Nested rows open/close (height) on the glide curve. */
  collapse: 240,
  /** Running chip: light band travel, and mark pulse (each half). */
  beam: 1700,
  pulse: 700,
  /** Settle (running → done/failed): glyph pop, row wash. */
  popUp: 120,
  popDown: 260,
  flashUp: 80,
  flashDown: 520,
  /** Chat strip stays after the last item settles, so the result is readable. */
  linger: 2600,
  /** Strip enter / exit. */
  enter: 200,
  exit: 160,
} as const;
