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
