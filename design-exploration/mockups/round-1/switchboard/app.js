const F = window.Frogg;
const $ = (s) => document.querySelector(s);
let current = F.sessions[0],
  filter = "all";
const ctx = { container: $("#chat"), scroller: $("#scroll") };
const rank = { permission: 0, error: 1, done: 2, running: 3, idle: 4 };
const tabs = [
  ["all", "All"],
  ["permission", "Needs you"],
  ["running", "Running"],
  ["done", "Unread"],
  ["error", "Failed"],
  ["idle", "Idle"],
];

function renderTri() {
  $("#tri").innerHTML = tabs
    .map(([k, l]) => {
      const n = k === "all" ? F.sessions.length : F.sessions.filter((s) => s.status === k).length;
      return `<button class="${filter === k ? "on" : ""} t-${k}" data-f="${k}">${l}<sup>${n}</sup></button>`;
    })
    .join("");
}
function renderRows() {
  const list = F.sessions
    .filter((s) => filter === "all" || s.status === filter)
    .sort((a, b) => rank[a.status] - rank[b.status]);
  let last = null;
  $("#rows").innerHTML = list
    .map((s) => {
      const p = F.projects.find((x) => x.id === s.project);
      const sec =
        s.status !== last
          ? `<div class="sec sec-${s.status}">${F.statusLabel[s.status]}</div>`
          : "";
      last = s.status;
      return (
        sec +
        `<button class="srow ${s.id === current.id ? "active" : ""} st-${s.status} ${s.unread ? "unread" : ""}" data-id="${s.id}" style="${F.agentStyle(s.agent)}">
      <span class="c-st">${F.dot(s.status)}</span>
      <span class="c-t"><b>${F.esc(s.title)}</b><i>${p.name} · ${s.branch}</i>${s.status === "permission" ? `<span class="ask">wants to run <code>pnpm db:migrate</code> <span class="qa" data-qa="${s.id}">Approve</span></span>` : ""}${s.status === "error" ? `<span class="ask err">exit 1 · retry.test.ts</span>` : ""}</span>
      <span class="c-ag">${F.agents[s.agent].short}</span>
      <span class="c-d">${s.add ? `<span class="add">+${s.add}</span> <span class="del">−${s.del}</span>` : "—"}</span>
      <span class="c-a">${s.ago}</span></button>`
      );
    })
    .join("");
}
function renderHead() {
  const p = F.projects.find((x) => x.id === current.project);
  $("#title").textContent = current.title;
  $("#meta").innerHTML =
    `${F.dot(current.status)} ${F.statusLabel[current.status]} · ${p.name} · <code>${current.branch}</code> · ${F.agents[current.agent].name} on ${p.host}`;
  $("#chg").textContent = current.add ? `+${current.add} −${current.del}` : "0";
  $("#strip").innerHTML = current.add ? F.diffStripHTML(current) : "";
}
function select(id) {
  current = F.sessions.find((s) => s.id === id);
  current.unread = 0;
  F.swap(() => {
    renderRows();
    renderHead();
    F.mountChat($("#chat"), current, ctx);
    document.body.dataset.mview = "chat";
  });
}
document.addEventListener("click", (e) => {
  const qa = e.target.closest("[data-qa]");
  if (qa) {
    e.stopPropagation();
    const s = F.sessions.find((x) => x.id === qa.dataset.qa);
    s.status = "running";
    renderTri();
    renderRows();
    return;
  }
  const r = e.target.closest(".srow");
  if (r) select(r.dataset.id);
  const t = e.target.closest("[data-f]");
  if (t) {
    filter = t.dataset.f;
    renderTri();
    renderRows();
  }
  if (e.target.closest("#back")) document.body.dataset.mview = "list";
  if (e.target.closest("#openPal")) pal.open();
  const tool = e.target.closest(".tool-head");
  if (tool) tool.parentElement.classList.toggle("open");
});
document.addEventListener("keydown", (e) => {
  if (e.target.isContentEditable || e.target.tagName === "INPUT") return;
  const ids = [...document.querySelectorAll(".srow")].map((r) => r.dataset.id);
  const i = ids.indexOf(current.id);
  if (e.key === "j") select(ids[Math.min(ids.length - 1, i + 1)]);
  if (e.key === "k") select(ids[Math.max(0, i - 1)]);
});
$("#composer").innerHTML = F.composerHTML({
  placeholder: "Reply…  ⏎ steer · ⌘⏎ queue · / commands",
});
F.wireComposer(document.body, ctx);
const pal = F.palette((s) => select(s.id));
renderTri();
renderRows();
renderHead();
F.mountChat($("#chat"), current, ctx);
if (!new URLSearchParams(location.search).get("m")) document.body.dataset.mview = "chat";
F.ambient((s) => {
  renderTri();
  renderRows();
  const r = document.querySelector(`.srow[data-id="${s.id}"]`);
  r && r.classList.add("flash");
});
