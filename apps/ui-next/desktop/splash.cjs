// The first thing a launch shows: painted from index.html before the UI bundle has parsed, so
// clicking the app gives an immediate, branded window instead of a blank one (#69). React
// replaces #root's children on its first render, which removes it with no extra code.

const BACKGROUND = "#080b0d";
const FAINT = "#5f6b6e";
const CYAN = "#25b5c8";

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const STYLE = `<style id="frogg-splash-style">
html,body{background:${BACKGROUND};margin:0}
.frogg-splash{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
font:500 12px/1 ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace;letter-spacing:.14em;
text-transform:uppercase;color:${FAINT};animation:frogg-splash-in .2s cubic-bezier(.22,1,.36,1) both}
.frogg-splash i{display:block;width:96px;height:2px;background:${CYAN}22;overflow:hidden;position:relative}
.frogg-splash i::after{content:"";position:absolute;inset:0;width:32px;background:${CYAN};
animation:frogg-splash-run 1.1s cubic-bezier(.22,1,.36,1) infinite}
@keyframes frogg-splash-in{from{opacity:0}to{opacity:1}}
@keyframes frogg-splash-run{from{transform:translateX(-32px)}to{transform:translateX(96px)}}
@media (prefers-reduced-motion:reduce){.frogg-splash,.frogg-splash i::after{animation:none}}
</style>`;

/** The splash markup that goes inside `#root`. */
function splashMarkup(name) {
  return `<div class="frogg-splash" role="status" aria-label="Starting ${escapeHtml(name)}"><span>${escapeHtml(name)}</span><i></i></div>`;
}

/** index.html with the splash style in `<head>` and the splash inside the empty `#root`. */
function injectSplash(html, name) {
  const root = '<div id="root"></div>';
  if (!html.includes(root)) throw new Error("index.html has no empty #root to put the splash in");
  return html
    .replace("</head>", `${STYLE}</head>`)
    .replace(root, `<div id="root">${splashMarkup(name)}</div>`);
}

module.exports = { injectSplash, splashMarkup };
