const F = window.Frogg;
const $ = (s) => document.querySelector(s);
const proj = (s) => F.projects.find((p) => p.id === s.project);
const order = [
  ["permission", "Needs you"],
  ["error", "Failed"],
  ["done", "Ready to review"],
  ["running", "Working"],
  ["idle", "Idle"],
];
let cur = null,
  scope = "all";
const inScope = (s) =>
  scope === "all"
    ? true
    : scope === "need"
      ? s.status === "permission" || s.status === "error"
      : s.project === scope;
function rail() {
  const need = F.sessions.filter((s) => s.status === "permission" || s.status === "error").length;
  const item = (k, inner, label, badge) =>
    `<button class="ri ${scope === k ? "on" : ""}" data-scope="${k}" aria-label="${label}">${inner}${badge ? `<span class="rb">${badge}</span>` : ""}<span class="tip">${label}</span></button>`;
  $("#rail").innerHTML =
    `<div class="logo">${R3.facet("frogg-brand", ["#7fd9e6", "#045b9d"], 26)}</div>` +
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
        return item(
          p.id,
          R3.projFacet(p.id, 26) + (live ? '<span class="live"></span>' : ""),
          `${p.name} · ${p.host}`,
        );
      })
      .join("") +
    '<button class="ri add" aria-label="Add project">+</button><span class="sp"></span>' +
    item(
      "settings",
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>',
      "Settings",
    );
}
function render(c) {
  cur = c;
  rail();
  $("#scopeName").innerHTML =
    scope === "all"
      ? "All sessions"
      : scope === "need"
        ? "Needs you"
        : `${R3.projFacet(scope, 16)}${F.projects.find((p) => p.id === scope).name}`;
  const n = (k) => F.sessions.filter((s) => s.status === k && inScope(s)).length;
  $("#fleet").innerHTML =
    `<span class="segs">${order.map(([k]) => `<span class="seg seg-${k}" style="flex:${n(k)}"></span>`).join("")}</span>` +
    `<span class="fleet-l">${order
      .filter(([k]) => n(k))
      .map(([k, l]) => `<span>${R3.glyph(k)}<b>${n(k)}</b> ${l.toLowerCase()}</span>`)
      .join("")}</span>`;
  $("#rows").innerHTML = order
    .map(([k, label]) => {
      const list = F.sessions.filter((s) => s.status === k && inScope(s));
      if (!list.length) return "";
      return `<div class="sec sec-${k}"><span>${label}</span><i>${list.length}</i></div>${list
        .map((s) => {
          const p = proj(s);
          return `<button class="row st-${s.status} ${s.id === c.id ? "on" : ""}" data-id="${s.id}" data-spot>
            <span class="r1">${R3.glyph(s.status)}<b>${F.esc(s.title)}</b><span class="ago">${s.ago}</span></span>
            <span class="r2">${R3.projFacet(p.id, 11)}<span>${p.name}</span><span class="br">${s.branch}</span>${s.add ? `<span class="d"><span class="add">+${s.add}</span> <span class="del">−${s.del}</span></span>` : ""}</span>
            ${s.status === "permission" ? `<span class="r3"><span class="cmd"><code>pnpm db:migrate --env staging</code></span><span class="qa" data-qa="${s.id}">Approve</span></span>` : ""}
            ${s.status === "error" ? `<span class="r3 e">${s.id === "s12" ? "terraform plan · host unreachable" : "exit 1 · retry.test.ts › backs off on 429"}</span>` : ""}
          </button>`;
        })
        .join("")}`;
    })
    .join("");
  requestAnimationFrame(() => R3.glide($("#list"), $("#brk"), ".row.on"));
  setTimeout(() => $("#fleet").classList.add("ready"), 1000);
}
function head(c) {
  const p = proj(c);
  $("#crumb").innerHTML = `${p.host} / ${p.name} / <b>${c.branch}</b>`;
  $("#title").textContent = c.title;
  $("#meta").innerHTML =
    `${R3.glyph(c.status)}<span>${F.statusLabel[c.status]}</span><span>${F.agents[c.agent].name}</span><span>Opus 5.5</span>`;
  $("#chgN").textContent = c.add ? `+${c.add} −${c.del}` : "";
  $("#strip").innerHTML = c.add ? F.diffStripHTML(c) : "";
  $("#drawer").innerHTML =
    `<div class="dr-h"><span class="eyebrow">Changes</span><button class="link" id="closePane">Close</button></div>${R3.changes(c)}`;
}
document.addEventListener("click", (e) => {
  const sc = e.target.closest("[data-scope]");
  if (sc && sc.dataset.scope !== "settings") {
    scope = sc.dataset.scope;
    $("#fleet").classList.remove("ready");
    render(cur);
    setTimeout(() => $("#fleet").classList.add("ready"), 1000);
  }
  if (e.target.closest("#togglePane") || e.target.closest(".dstrip-sum"))
    document.body.classList.toggle("pane-open");
  if (e.target.closest("#closePane")) document.body.classList.remove("pane-open");
});
document.addEventListener("keydown", (e) => {
  if (e.target.isContentEditable || e.target.tagName === "INPUT") return;
  if (e.key === "a" && cur.status === "permission")
    document.querySelector(`[data-qa="${cur.id}"]`)?.click();
});
R3.spotlight(document.body);
Kit({
  render,
  head,
  placeholder: "Reply — ⏎ to steer, ⌘⏎ to queue, / for commands",
  onEvent: (s) => document.querySelector(`.row[data-id="${s.id}"]`)?.classList.add("ping"),
});
addEventListener("resize", () => R3.glide($("#list"), $("#brk"), ".row.on"));
