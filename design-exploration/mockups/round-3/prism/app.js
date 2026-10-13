const F = window.Frogg;
const $ = (s) => document.querySelector(s);
const proj = (s) => F.projects.find((p) => p.id === s.project);
let scope = "all",
  view = "chat",
  cur = null;
const rank = { permission: 0, error: 1, running: 2, done: 3, idle: 4 };
function rail() {
  const need = F.sessions.filter((s) => s.status === "permission").length;
  const item = (k, inner, label, badge) =>
    `<button class="ri ${scope === k ? "on" : ""}" data-scope="${k}" title="${label}">${inner}${badge ? `<span class="rb">${badge}</span>` : ""}<span class="tip">${label}</span></button>`;
  $("#rail").innerHTML =
    `<div class="logo">${R3.facet("frogg-brand", ["#25b5c8", "#045b9d"], 26)}</div>` +
    item(
      "all",
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>',
      "All sessions",
    ) +
    item(
      "need",
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 2 20h20zM12 10v4M12 17h.01"/></svg>',
      "Needs you",
      need,
    ) +
    '<span class="rsep"></span>' +
    F.projects
      .map((p) => {
        const live = F.sessions.filter((s) => s.project === p.id && s.status === "running").length;
        return item(p.id, R3.projFacet(p.id, 26), `${p.name} · ${p.host}`, "", live) + "";
      })
      .join("") +
    '<button class="ri add" title="Add project">+</button>';
}
function render(c) {
  cur = c;
  rail();
  const list = F.sessions
    .filter((s) =>
      scope === "all"
        ? true
        : scope === "need"
          ? s.status === "permission" || s.status === "error"
          : s.project === scope,
    )
    .sort((a, b) => rank[a.status] - rank[b.status]);
  $("#scopeName").textContent =
    scope === "all"
      ? "All sessions"
      : scope === "need"
        ? "Needs you"
        : F.projects.find((p) => p.id === scope).name;
  $("#rows").innerHTML =
    list
      .map((s) => {
        const p = proj(s);
        return `<button class="row st-${s.status} ${s.id === c.id ? "on" : ""}" data-id="${s.id}" data-spot>
        <span class="r1"><b>${F.esc(s.title)}</b><span class="ago">${s.ago}</span></span>
        <span class="r2">${R3.glyph(s.status)}<span class="stl">${F.statusLabel[s.status]}</span>${scope === "all" || scope === "need" ? `<span class="pj">${R3.projFacet(p.id, 11)}${p.name}</span>` : `<span class="pj mono">${s.branch}</span>`}${s.unread ? `<span class="u">${s.unread} new</span>` : ""}</span>
        ${s.status === "permission" ? `<span class="r3"><code>pnpm db:migrate</code><span class="qa" data-qa="${s.id}">Approve</span></span>` : ""}
      </button>`;
      })
      .join("") || `<div class="none">Nothing here. Nice.</div>`;
  requestAnimationFrame(() => R3.glide($("#list"), $("#skew"), ".row.on"));
}
function head(c) {
  const p = proj(c);
  $("#crumb").innerHTML = `${p.host} / ${p.name} / ${c.branch}`;
  $("#title").textContent = c.title;
  $("#chgN").textContent = c.add ? "4" : "";
  $("#strip").innerHTML = c.add ? F.diffStripHTML(c) : "";
  $("#vChanges").innerHTML = R3.changes(c);
  $("#vTerm").innerHTML = R3.terminal();
}
function setView(v) {
  view = v;
  document
    .querySelectorAll("#seg button")
    .forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  $("#views").dataset.v = v;
  R3.glide($("#seg"), $("#segInd"), "button.on");
}
document.addEventListener("click", (e) => {
  const s = e.target.closest("[data-scope]");
  if (s) {
    scope = s.dataset.scope;
    $("#list").classList.remove("ready");
    render(cur);
    setTimeout(() => $("#list").classList.add("ready"), 700);
  }
  const v = e.target.closest("[data-v]");
  if (v) setView(v.dataset.v);
  if (e.target.closest(".dstrip-sum")) setView("changes");
});
R3.spotlight(document.body);
Kit({
  render,
  head,
  placeholder: "Message Claude Code — ⏎ to steer, ⌘⏎ to queue, / for commands",
  onEvent: (s) => document.querySelector(`.row[data-id="${s.id}"]`)?.classList.add("ping"),
});
setView("chat");
setTimeout(() => $("#list").classList.add("ready"), 700);
addEventListener("resize", () => {
  R3.glide($("#list"), $("#skew"), ".row.on");
  R3.glide($("#seg"), $("#segInd"), "button.on");
});
