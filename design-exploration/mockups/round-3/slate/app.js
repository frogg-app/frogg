const F = window.Frogg;
const $ = (s) => document.querySelector(s);
const proj = (s) => F.projects.find((p) => p.id === s.project);
const ico = {
  sessions: '<path d="M4 5h16M4 12h16M4 19h10"/>',
  changes:
    '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="12" r="2"/><path d="M6 8v8M8 6c6 0 8 2 8 4"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>',
  hosts:
    '<rect x="3" y="4" width="18" height="6"/><rect x="3" y="14" width="18" height="6"/><path d="M7 7h.01M7 17h.01"/>',
  plugins: '<path d="M4 4h7v7H4zM13 13h7v7h-7zM13 4h7v7h-7z"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
};
let open = ["s1", "s2", "s7"],
  act = "sessions",
  cur = null;
const seen = new Set();
const closed = new Set(["infra"]);
function actBar() {
  $("#act").innerHTML =
    `<div class="logo">${R3.facet("frogg-brand", ["#7fd9e6", "#045b9d"], 22)}</div>` +
    Object.entries(ico)
      .map(
        ([k, d]) =>
          `<button class="ab ${act === k ? "on" : ""} ${k === "settings" ? "end" : ""}" data-act="${k}" title="${k}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">${d}</svg>${k === "sessions" ? `<span class="pip">${F.sessions.filter((s) => s.status === "permission").length}</span>` : ""}</button>`,
      )
      .join("");
}
function render(c) {
  cur = c;
  if (!open.includes(c.id)) open.push(c.id);
  actBar();
  const need = F.sessions.filter((s) => s.status === "permission" || s.status === "error");
  const row = (
    s,
    d,
  ) => `<button class="node st-${s.status} ${s.id === c.id ? "on" : ""}" data-id="${s.id}" data-spot style="--d:${d}">
      ${R3.glyph(s.status)}<span class="nt">${F.esc(s.title)}</span>${s.unread ? `<span class="u">${s.unread}</span>` : `<span class="ag">${F.agents[s.agent].short}</span>`}</button>`;
  $("#rows").innerHTML =
    `<div class="sect"><span>Attention</span><i>${need.length}</i></div>${need.map((s) => row(s, 0)).join("")}` +
    `<div class="sect"><span>Projects</span></div>` +
    F.projects
      .map((p) => {
        const list = F.sessions.filter((s) => s.project === p.id);
        const shut = closed.has(p.id);
        return `<button class="folder ${shut ? "shut" : ""}" data-fold="${p.id}"><span class="caret">›</span>${R3.projFacet(p.id, 13)}<span>${p.name}</span><i>${p.host}</i></button>${shut ? "" : list.map((s) => row(s, 1)).join("")}`;
      })
      .join("");
  $("#tabs").innerHTML =
    open
      .map((id) => {
        const s = F.sessions.find((x) => x.id === id);
        const fresh = seen.has(id) ? "" : "fresh";
        seen.add(id);
        return `<button class="tab ${fresh} ${id === c.id ? "on" : ""}" data-id="${id}">${R3.glyph(s.status)}<span>${F.esc(s.title)}</span><span class="x" data-close="${id}">×</span></button>`;
      })
      .join("") + `<span class="tab-fill"></span>`;
  const need2 = F.sessions.filter((s) => s.status === "permission").length;
  $("#status").innerHTML =
    `<span class="sb host">${R3.glyph("done")} devbox</span><span class="sb mono">⎇ ${c.branch}</span><span class="sb">${c.add ? `<span class="add">+${c.add}</span> <span class="del">−${c.del}</span>` : "clean"}</span>
    <span class="sp"></span>${need2 ? `<button class="sb warn" data-id="${F.sessions.find((s) => s.status === "permission").id}">${R3.glyph("permission")} ${need2} need you</button>` : ""}
    <span class="sb">${F.agents[c.agent].name} · Opus 5.5</span><span class="sb">${F.ring(42, "5h", 16)}${F.ring(86, "wk", 16)}${F.ring(23, "ctx", 16)}</span><span class="sb">UTF-8</span>`;
  F.animateRings($("#status"));
  requestAnimationFrame(() => R3.glide($("#list"), $("#notch"), ".node.on"));
}
function head(c) {
  const p = proj(c);
  $("#crumb").innerHTML =
    `<button class="m-back" data-back>←</button>${R3.projFacet(p.id, 12)}<span>${p.name}</span><i>›</i><span>${c.branch}</span><i>›</i><b>${F.esc(c.title)}</b><span class="cm">${F.statusLabel[c.status]}</span>`;
  $("#strip").innerHTML = c.add ? F.diffStripHTML(c) : "";
  $("#side2").innerHTML =
    `<div class="s2-h"><span class="eyebrow">Changes</span><span class="mono">${c.add ? "4 files" : ""}</span></div>${R3.changes(c)}`;
  $("#panelBody").innerHTML = R3.terminal();
}
document.addEventListener("click", (e) => {
  const x = e.target.closest("[data-close]");
  if (x) {
    e.stopPropagation();
    open = open.filter((i) => i !== x.dataset.close);
    if (!open.length) open = ["s1"];
    if (cur.id === x.dataset.close) document.querySelector(`.tab[data-id="${open[0]}"]`)?.click();
    else render(cur);
    return;
  }
  const f = e.target.closest("[data-fold]");
  if (f) {
    const k = f.dataset.fold;
    closed.has(k) ? closed.delete(k) : closed.add(k);
    render(cur);
  }
  const a = e.target.closest("[data-act]");
  if (a) {
    act = a.dataset.act;
    actBar();
  }
  if (e.target.closest("#panelToggle")) document.body.classList.toggle("panel-min");
});
R3.spotlight(document.body);
Kit({
  render,
  head,
  placeholder: "Message Claude Code — ⏎ to steer, ⌘⏎ to queue, / for commands",
  onEvent: (s) => document.querySelector(`.node[data-id="${s.id}"]`)?.classList.add("ping"),
});
addEventListener("resize", () => R3.glide($("#list"), $("#notch"), ".node.on"));
