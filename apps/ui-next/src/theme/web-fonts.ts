import { alpha, color, scheme } from "./tokens";

// Web: the themed page reset, then the three faces once. Native will bundle them via expo-font.
// The desktop shell links its own fonts (`#frogg-fonts`), but still needs the themed reset.
export function loadWebFonts(): void {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return;
  if (!doc.getElementById("frogg-theme")) {
    const style = doc.createElement("style");
    style.id = "frogg-theme";
    style.textContent = `
:root{color-scheme:${scheme}}
html,body,#root{background:${color.bg};height:100%}
*{scrollbar-width:thin;scrollbar-color:${alpha(color.ink, 0.16)} transparent}
@media (prefers-reduced-motion: reduce){*{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}}
`;
    doc.head.appendChild(style);
  }
  if (doc.getElementById("frogg-fonts")) return;
  const link = doc.createElement("link");
  link.id = "frogg-fonts";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
  doc.head.appendChild(link);
}
