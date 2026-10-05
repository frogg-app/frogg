const F = window.Frogg;
const $ = (s) => document.querySelector(s);
const proj = (s) => F.projects.find((p) => p.id === s.project);
const rev = {
  permission: "HOLD",
  error: "VOID",
  done: "ISSUED",
  running: "DRAFTING",
  idle: "SHELVED",
};
// A wobbly hand-drawn ellipse, different per session so it never looks stamped.
function scribble(seed) {
  let r = seed * 9301 + 49297;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280 - 0.5) * 6;
  const pts = [];
  for (let i = 0; i <= 26; i++) {
    const a = (i / 24) * Math.PI * 2 - 0.4;
    pts.push(
      `${(150 + Math.cos(a) * (146 + rnd())).toFixed(1)},${(50 + Math.sin(a) * (46 + rnd())).toFixed(1)}`,
    );
  }
  return `<svg class="circ" viewBox="0 0 300 100" preserveAspectRatio="none"><path pathLength="1" d="M${pts.join(" L")}"/></svg>`;
}
function spark(s) {
  const n = s.status === "running" ? 18 : 10;
  let x = 0;
  const ys = Array.from(
    { length: n },
    (_, i) => 14 - Math.abs(Math.sin(i * 1.7 + s.add)) * (s.status === "idle" ? 2 : 11),
  );
  return `<svg class="spark" viewBox="0 0 ${(n - 1) * 6} 16"><polyline points="${ys.map((y) => `${x++ * 6},${y.toFixed(1)}`).join(" ")}"/></svg>`;
}
function render(cur) {
  $("#sheets").innerHTML = F.sessions
    .map(
      (
        s,
        i,
      ) => `<button class="sheet st-${s.status} ${s.id === cur.id ? "on" : ""}" data-id="${s.id}">
        <span class="sh-top"><span class="no">${String(i + 1).padStart(2, "0")}/${F.sessions.length}</span><span class="rev">${rev[s.status]}</span></span>
        <span class="t">${F.esc(s.title)}</span>
        ${spark(s)}
        <span class="tbk"><span>${proj(s).name}</span><span>${F.agents[s.agent].short}</span><span>${s.add ? `+${s.add}/−${s.del}` : "—"}</span><span>${s.ago}</span></span>
        ${s.status === "permission" ? `<span class="redline">needs your sign-off → <span class="qa" data-qa="${s.id}">approve</span></span>` : ""}
        ${s.status === "error" ? `<span class="redline">failed here ✗</span>` : ""}
        ${s.id === cur.id ? scribble(i + 3) : ""}
      </button>`,
    )
    .join("");
}
function head(cur) {
  const p = proj(cur);
  $("#title").textContent = cur.title;
  $("#tb").innerHTML = [
    ["PROJECT", p.name],
    ["DRAWN BY", F.agents[cur.agent].name],
    ["SITE", p.host],
    ["BRANCH", cur.branch],
    ["REV", cur.add ? `+${cur.add} −${cur.del}` : "0"],
    ["STATUS", rev[cur.status]],
  ]
    .map(([k, v]) => `<span><i>${k}</i><b>${F.esc(v)}</b></span>`)
    .join("");
  $("#strip").innerHTML = cur.add ? F.diffStripHTML(cur) : "";
}
const view = (v) => {
  F.swap(() => {
    document.body.dataset.view = v;
    $("#toGrid").classList.toggle("on", v === "grid");
    $("#toFocus").classList.toggle("on", v === "focus");
  });
};
$("#toGrid").onclick = () => view("grid");
$("#toFocus").onclick = () => view("focus");
document.addEventListener("click", (e) => {
  if (
    e.target.closest(".sheet") &&
    !e.target.closest("[data-qa]") &&
    document.body.dataset.view === "grid"
  )
    view("focus");
});
document.addEventListener("keydown", (e) => {
  if (e.target.isContentEditable || e.target.tagName === "INPUT") return;
  if (e.key === "g") view(document.body.dataset.view === "grid" ? "focus" : "grid");
});
setInterval(() => ($("#clock").textContent = new Date().toTimeString().slice(0, 8)), 1000);
Kit({
  render,
  head,
  placeholder: "Annotate…  ⏎ steer · ⌘⏎ queue",
  onEvent: (s) => document.querySelector(`.sheet[data-id="${s.id}"]`)?.classList.add("flash"),
});
