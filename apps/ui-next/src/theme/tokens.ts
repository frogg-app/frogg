// Bracket + Rail tokens, lifted from design-exploration/mockups/round-3/_shared/r3.css.
export const color = {
  bg: "#080b0d",
  bg2: "#0c1114",
  panel: "#0e1418",
  raise: "#131b20",
  line: "rgba(255,255,255,0.08)",
  line2: "rgba(255,255,255,0.16)",
  wash: "rgba(255,255,255,0.03)",
  text: "#f2f6f7",
  muted: "#9aa6a9",
  faint: "#5f6b6e",
  cyan: "#25b5c8",
  cyan2: "#7fd9e6",
  deep: "#045b9d",
  mint: "#3fcf8e",
  violet: "#8b7cf6",
  amber: "#f5b84a",
  coral: "#ff6b6b",
  onAccent: "#04161a",
} as const;

export const font = {
  body: "Inter",
  display: "Space Grotesk",
  mono: "JetBrains Mono",
} as const;

export const ease = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Width breakpoints: phone below `tablet`, rail + one pane below `desktop`, full IDE above. */
export const bp = { tablet: 700, desktop: 1100 } as const;

/** CSS-only style keys (gradients, outline, resize) that RN types do not know; dropped on native. */
export const web = (style: Record<string, string | number>): object =>
  (globalThis as { document?: unknown }).document ? style : {};

/** Syntax colours tuned to the Bracket palette (cyan / violet / amber / mint). */
export const syntax: Record<string, string> = {
  keyword: "#8b7cf6", comment: "#5f6b6e", string: "#7fe3b2", number: "#f5b84a", literal: "#f5b84a",
  function: "#7fd9e6", definition: "#7fd9e6", class: "#ffcf7a", type: "#b1a6fa", tag: "#7fd9e6",
  attribute: "#f5b84a", property: "#c9e6ea", variable: "#f2f6f7", operator: "#9aa6a9", punctuation: "#9aa6a9",
  regexp: "#7fe3b2", escape: "#f5b84a", meta: "#5f6b6e", heading: "#7fd9e6", link: "#25b5c8",
};

type Frames = Record<string, Record<string, string | number>>;

/** Keyframes RN-web turns into CSS @keyframes (it rejects `animation` and `animationName`). */
export const frames = {
  breathe: { "0%": { opacity: 0.45 }, "50%": { opacity: 1 }, "100%": { opacity: 0.45 } },
  snap: { "0%": { opacity: 0, transform: "scale(1.06)" }, "100%": { opacity: 1, transform: "scale(1)" } },
  enter: { "0%": { opacity: 0, transform: "translateY(6px)" }, "100%": { opacity: 1, transform: "translateY(0px)" } },
  fade: { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
  shimmer: { "0%": { backgroundPosition: "200% 0" }, "100%": { backgroundPosition: "-200% 0" } },
  beam: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(400%)" } },
  afterglow: { "0%": { backgroundColor: "rgba(63,207,142,0.28)" }, "100%": { backgroundColor: "rgba(63,207,142,0.09)" } },
} satisfies Record<string, Frames>;

export function anim(kf: Frames, duration: string, timing = "cubic-bezier(0.23, 1, 0.32, 1)", count: number | "infinite" = 1, fill = "both"): object {
  if (!(globalThis as { document?: unknown }).document) return {};
  return { animationKeyframes: kf, animationDuration: duration, animationTimingFunction: timing, animationIterationCount: count, animationFillMode: fill };
}

/** Web-only animations; keyframes live in web-fonts.ts. Native gets nothing (static state). */
export const motion = {
  breathe: anim(frames.breathe, "1.6s", "ease-in-out", "infinite"),
  snap: anim(frames.snap, "220ms"),
  enter: anim(frames.enter, "200ms"),
  fade: anim(frames.fade, "150ms", "ease-out"),
  afterglow: anim(frames.afterglow, "1.2s", "ease-out"),
  shimmerText: web({
    backgroundImage: "linear-gradient(90deg, #5f6b6e 0%, #5f6b6e 35%, #7fd9e6 50%, #5f6b6e 65%, #5f6b6e 100%)",
    backgroundSize: "200% 100%",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
  }),
  shimmerRun: anim(frames.shimmer, "2s", "linear", "infinite", "none"),
};
