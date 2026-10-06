// Web: load the three faces and the page reset once. Native will bundle them via expo-font.
const doc = (globalThis as { document?: Document }).document;
if (doc && !doc.getElementById("frogg-fonts")) {
  const link = doc.createElement("link");
  link.id = "frogg-fonts";
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap";
  doc.head.appendChild(link);
  const style = doc.createElement("style");
  style.textContent = `
html,body,#root{background:#080b0d;height:100%}
*{scrollbar-width:thin;scrollbar-color:#ffffff29 transparent}
@media (prefers-reduced-motion: reduce){*{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}}
`;
  doc.head.appendChild(style);
}
export {};
