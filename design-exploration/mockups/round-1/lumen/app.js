const F = window.Frogg;
const $ = (s) => document.querySelector(s);
let current = F.sessions[0];
const ctx = { container: $("#chat"), scroller: $("#scroll") };
const initials = (t) =>
  t
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
const av = (s, cls = "") =>
  `<span class="avatar ${cls} st-${s.status}" style="${F.agentStyle(s.agent)}">${initials(s.title)}<i class="ring-st"></i></span>`;

function renderRail() {
  let html = "",
    lastP = null;
  for (const p of F.projects) {
    html += `<div class="rl-proj"><span>${p.name}</span></div>`;
    html += F.sessions
      .filter((s) => s.project === p.id)
      .map(
        (s) =>
          `<button class="rl-item ${s.id === current.id ? "on" : ""}" data-id="${s.id}">${av(s)}<span class="rl-t">${F.esc(s.title)}<small>${F.statusLabel[s.status]} · ${F.agents[s.agent].name}</small></span>${s.unread ? `<b class="badge">${s.unread}</b>` : ""}</button>`,
      )
      .join("");
  }
  $("#rlist").innerHTML = html;
}
function renderStack() {
  const asks = F.sessions.filter(
    (s) => (s.status === "permission" || s.status === "error") && s.id !== current.id,
  );
  $("#stack").innerHTML =
    `<div class="stack-h">Needs you · ${asks.length}</div>` +
    asks
      .map(
        (s, i) =>
          `<div class="ask st-${s.status}" data-id="${s.id}" style="--n:${i}">${av(s, "sm")}<div class="ask-b"><b>${F.esc(s.title)}</b><span>${s.status === "permission" ? "wants to run <code>pnpm db:migrate</code>" : "failed · overloaded_error"}</span></div>${s.status === "permission" ? '<div class="ask-a"><button class="yes">Allow</button><button class="no">Deny</button></div>' : '<div class="ask-a"><button class="yes">Retry</button></div>'}</div>`,
      )
      .join("");
}
function renderHead() {
  const p = F.projects.find((x) => x.id === current.project);
  $("#pav").outerHTML = av(current, "big").replace('class="avatar', 'id="pav" class="avatar');
  $("#title").textContent = current.title;
  $("#sub").innerHTML =
    `<span class="pillst st-${current.status}">${F.dot(current.status)}${F.statusLabel[current.status]}</span><span>${F.agents[current.agent].name}</span><span>${p.name}</span><code>${current.branch}</code><button class="link" id="canvasBtn">Canvas ◨</button>`;
  $("#strip").innerHTML = current.add ? F.diffStripHTML(current) : "";
  $("#cvBody").innerHTML = current.add
    ? `<div class="cv-sum"><b>4 files</b><span class="add">+${current.add}</span><span class="del">−${current.del}</span></div>` +
      ["session-store.ts", "write-queue.ts", "lru.ts"]
        .map(
          (f, fi) =>
            `<div class="cv-file"><div class="cv-fh">${f}<span><button>Keep</button><button>Undo</button></span></div><div class="hunk">${["-  const cache = new Map();", "+  const cache = new LRU({ max: 500 });", "+  const writes = new WriteQueue(db);", "   return {"].map((l, i) => `<div class="dl ${l[0] === "+" ? "add" : l[0] === "-" ? "del" : "ctx"}" style="--i:${i + fi * 4}">${F.esc(l)}</div>`).join("")}</div></div>`,
        )
        .join("")
    : '<p class="cv-empty">Nothing to show yet.</p>';
}
function select(id) {
  current = F.sessions.find((s) => s.id === id);
  current.unread = 0;
  F.swap(() => {
    renderRail();
    renderStack();
    renderHead();
    F.mountChat($("#chat"), current, ctx);
  });
}
document.addEventListener("click", (e) => {
  const a = e.target.closest(".ask");
  if (a && e.target.closest(".ask-a button")) {
    e.stopPropagation();
    a.classList.add("leaving");
    const s = F.sessions.find((x) => x.id === a.dataset.id);
    setTimeout(() => {
      s.status = e.target.classList.contains("yes") ? "running" : "idle";
      renderStack();
      renderRail();
    }, 220);
    return;
  }
  if (a) return select(a.dataset.id);
  const r = e.target.closest(".rl-item");
  if (r) select(r.dataset.id);
  if (e.target.closest("#openPal")) pal.open();
  if (e.target.closest("#canvasBtn") || e.target.closest(".dstrip-sum"))
    document.body.classList.toggle("canvas-open");
  const t = e.target.closest(".cv-tabs button");
  if (t)
    document.querySelectorAll(".cv-tabs button").forEach((b) => b.classList.toggle("on", b === t));
  const tool = e.target.closest(".tool-head");
  if (tool) tool.parentElement.classList.toggle("open");
});
$("#composer").innerHTML = F.composerHTML({ placeholder: "Ask, steer, or drop files…" });
F.wireComposer(document.body, ctx);
const pal = F.palette((s) => select(s.id));
renderRail();
renderStack();
renderHead();
F.mountChat($("#chat"), current, ctx);
if (innerWidth > 1300) document.body.classList.add("canvas-open");
F.ambient((s) => {
  renderRail();
  renderStack();
  const r = document.querySelector(`.rl-item[data-id="${s.id}"] .avatar`);
  r && r.classList.add("pop");
});
