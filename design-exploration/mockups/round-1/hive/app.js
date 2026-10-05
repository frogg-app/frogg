const F = window.Frogg;
const $ = (s) => document.querySelector(s);
let current = F.sessions[0];
const ctx = { container: $("#chat"), scroller: $("#scroll") };
const tails = {
  running: [
    "▸ Edit packages/server/src/lru.ts",
    "▸ Run pnpm test",
    "Swapping the cache for an LRU and batching…",
  ],
  permission: ["⚠ wants: pnpm db:migrate --env staging"],
  error: ["✕ overloaded_error after 3 retries"],
  done: ["✓ Finished · ready for review"],
  idle: ["— waiting for you"],
};
const spark = (seed) => {
  let p = "",
    y = 20;
  for (let i = 0; i <= 24; i++) {
    y = Math.max(3, Math.min(37, y + Math.sin(i * seed) * 9 + (Math.random() - 0.5) * 8));
    p += `${i ? "L" : "M"}${i * 10},${y.toFixed(1)}`;
  }
  return p;
};

function tile(s, i) {
  const p = F.projects.find((x) => x.id === s.project);
  return `<button class="tile st-${s.status}" data-id="${s.id}" style="${F.agentStyle(s.agent)};--i:${Math.min(i, 8)}">
    <div class="tile-top">${F.dot(s.status)}<span class="tile-ag">${F.agents[s.agent].name}</span><span class="tile-p">${p.name}</span></div>
    <div class="tile-t">${F.esc(s.title)}</div>
    <div class="tile-tail">${tails[s.status][0]}</div>
    <svg class="tile-spark" viewBox="0 0 240 40" preserveAspectRatio="none"><path d="${s.status === "idle" ? "M0,36L240,36" : spark(0.4 + i * 0.13)}"/></svg>
    <div class="tile-f"><code>${s.branch}</code><span>${s.add ? `<span class="add">+${s.add}</span> <span class="del">−${s.del}</span>` : ""}</span>${s.unread ? `<span class="badge">${s.unread}</span>` : ""}</div>
    ${s.status === "permission" ? '<div class="tile-ask"><span class="qa">Approve</span><span class="qd">Deny</span></div>' : ""}
  </button>`;
}
const order = { permission: 0, error: 1, running: 2, done: 3, idle: 4 };
function renderGrid() {
  const ss = [...F.sessions].sort((a, b) => order[a.status] - order[b.status]);
  $("#grid").innerHTML =
    `<div class="grid-h"><h2>Fleet</h2><span>${ss.filter((s) => s.status === "running").length} running · ${ss.filter((s) => s.status === "permission").length} need you · ${ss.filter((s) => s.status === "error").length} failed</span></div><div class="tiles">${ss.map(tile).join("")}</div>`;
}
function renderRail() {
  const ss = [...F.sessions].sort((a, b) => order[a.status] - order[b.status]);
  $("#rail").innerHTML = ss
    .map(
      (s) =>
        `<button class="mini ${s.id === current.id ? "on" : ""} st-${s.status}" data-id="${s.id}" style="${F.agentStyle(s.agent)}" title="${F.esc(s.title)}">${F.dot(s.status)}<span class="mini-t">${F.esc(s.title)}</span><span class="mini-ag">${F.agents[s.agent].short}</span>${s.unread ? `<span class="badge">${s.unread}</span>` : ""}</button>`,
    )
    .join("");
}
function renderPanel() {
  const p = F.projects.find((x) => x.id === current.project);
  $("#panel").setAttribute("style", F.agentStyle(current.agent));
  $("#title").textContent = current.title;
  $("#sub").innerHTML =
    `${F.agents[current.agent].name} · ${p.name} · <code>${current.branch}</code> · ${p.host}`;
  $("#phDot").innerHTML = F.dot(current.status);
  $("#strip").innerHTML = current.add ? F.diffStripHTML(current) : "";
  $("#ctxBody").innerHTML = current.add
    ? [
        ["session-store.ts", 112, 41],
        ["write-queue.ts", 64, 0],
        ["lru.ts", 31, 0],
        ["session-store.test.ts", 7, 46],
      ]
        .map(
          ([f, a, d]) =>
            `<div class="cf"><span>${f}</span><span class="add">+${a}</span><span class="del">−${d}</span><span class="cbar"><i style="width:${(a / (a + d)) * 100}%"></i></span></div>`,
        )
        .join("")
    : '<div class="cf">No changes</div>';
  $("#spark").innerHTML = `<path d="${spark(0.55)}"/>`;
}
function open(id, fromEl) {
  current = F.sessions.find((s) => s.id === id);
  current.unread = 0;
  if (fromEl) fromEl.style.viewTransitionName = "morph";
  $("#panel").style.viewTransitionName = "";
  F.swap(() => {
    if (fromEl) fromEl.style.viewTransitionName = "";
    document.body.dataset.view = "focus";
    $("#panel").style.viewTransitionName = "morph";
    renderRail();
    renderPanel();
    F.mountChat($("#chat"), current, ctx);
  });
}
function toGrid() {
  $("#panel").style.viewTransitionName = "morph";
  F.swap(() => {
    $("#panel").style.viewTransitionName = "";
    document.body.dataset.view = "grid";
    renderGrid();
    const t = document.querySelector(`.tile[data-id="${current.id}"]`);
    if (t) t.style.viewTransitionName = "morph";
  });
  setTimeout(
    () => document.querySelectorAll(".tile").forEach((t) => (t.style.viewTransitionName = "")),
    600,
  );
}
document.addEventListener("click", (e) => {
  const qa = e.target.closest(".qa, .qd");
  if (qa) {
    e.stopPropagation();
    const id = qa.closest(".tile").dataset.id;
    F.sessions.find((s) => s.id === id).status = qa.classList.contains("qa") ? "running" : "idle";
    renderGrid();
    return;
  }
  const t = e.target.closest(".tile");
  if (t) open(t.dataset.id, t);
  const m = e.target.closest(".mini");
  if (m) {
    current = F.sessions.find((s) => s.id === m.dataset.id);
    current.unread = 0;
    F.swap(() => {
      renderRail();
      renderPanel();
      F.mountChat($("#chat"), current, ctx);
    });
  }
  if (e.target.closest("#gridBtn") || e.target.closest("#back")) toGrid();
  if (e.target.closest("#ctxBtn")) document.body.classList.toggle("no-ctx");
  if (e.target.closest("#openPal")) pal.open();
  if (e.target.closest("#island")) document.body.classList.toggle("island-open");
  const tool = e.target.closest(".tool-head");
  if (tool) tool.parentElement.classList.toggle("open");
});
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
    e.preventDefault();
    document.body.dataset.view === "grid" ? open(current.id) : toGrid();
  }
});
$("#composer").innerHTML = F.composerHTML({ placeholder: "Direct this agent…" });
F.wireComposer(document.body, ctx);
const pal = F.palette((s) => open(s.id));
renderGrid();
const isM = new URLSearchParams(location.search).get("m");
if (!isM) {
  document.body.dataset.view = "focus";
  renderRail();
  renderPanel();
  F.mountChat($("#chat"), current, ctx);
}
const events = [
  "3 agents running",
  "Codex needs approval",
  "Rewrite pairing guide finished",
  "3 agents running",
];
let ei = 0;
setInterval(() => {
  const el = $("#islandText");
  el.classList.remove("morph-in");
  void el.offsetWidth;
  el.textContent = events[++ei % events.length];
  el.classList.add("morph-in");
}, 3500);
F.ambient((s) => {
  renderGrid();
  if (document.body.dataset.view === "focus") renderRail();
  const r = document.querySelector(`[data-id="${s.id}"]`);
  r && r.classList.add("pulse-once");
});
