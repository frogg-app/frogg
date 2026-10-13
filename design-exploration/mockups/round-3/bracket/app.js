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
let cur = null;
$("#brand").innerHTML = R3.facet("frogg-brand", ["#7fd9e6", "#045b9d"], 20) + "<span>frogg</span>";
function render(c) {
  cur = c;
  const n = (k) => F.sessions.filter((s) => s.status === k).length;
  $("#fleet").innerHTML =
    `<span class="segs">${order.map(([k]) => `<span class="seg seg-${k}" style="flex:${n(k)}"></span>`).join("")}</span>` +
    `<span class="fleet-l">${order
      .filter(([k]) => n(k))
      .map(([k, l]) => `<span>${R3.glyph(k)}<b>${n(k)}</b> ${l.toLowerCase()}</span>`)
      .join("")}</span>`;
  $("#rows").innerHTML = order
    .map(([k, label]) => {
      const list = F.sessions.filter((s) => s.status === k);
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
