const F = window.Frogg;
const $ = (s) => document.querySelector(s);
let current = F.sessions[0];
const ctx = { container: $("#chat"), scroller: $("#scroll") };

function row(s) {
  const p = F.projects.find((x) => x.id === s.project);
  return `<button class="row ${s.id === current.id ? "active" : ""} st-${s.status}" data-id="${s.id}" style="${F.agentStyle(s.agent)}">
    ${F.dot(s.status)}
    <span class="row-main"><span class="row-t">${F.esc(s.title)}</span>
      <span class="row-sub"><span class="agent-tag">${F.agents[s.agent].short}</span>${s.branch}${s.status === "permission" ? "" : ""}</span></span>
    <span class="row-side">${s.add ? `<span><span class="add">+${s.add}</span><span class="del">−${s.del}</span></span>` : ""}${s.unread ? `<span class="badge">${s.unread}</span>` : `<span class="ago">${s.ago}</span>`}</span>
  </button>`;
}
function renderSide() {
  const needs = F.sessions.filter((s) => s.status === "permission" || s.status === "error");
  $("#needs").innerHTML = needs.map(row).join("");
  $("#needsCount").textContent = needs.length;
  $("#groups").innerHTML = F.projects
    .map((p) => {
      const ss = F.sessions.filter((s) => s.project === p.id && !needs.includes(s));
      return `<div class="group"><div class="group-h"><span class="caret">▾</span>${p.name}<span class="host-tag">${p.host}</span></div>${ss.map(row).join("")}</div>`;
    })
    .join("");
}
function renderHead() {
  const p = F.projects.find((x) => x.id === current.project);
  $("#title").textContent = current.title;
  $("#crumbs").innerHTML =
    `<span>${p.name}</span><span class="branch">⑂ ${current.branch}</span><span class="agent-tag" style="${F.agentStyle(current.agent)}">${F.agents[current.agent].name}</span><span class="st">${F.dot(current.status)}${F.statusLabel[current.status]}</span>`;
  $("#strip").innerHTML = current.add ? F.diffStripHTML(current) : "";
}
function renderPane() {
  const files = [
    ["packages/server/src/session-store.ts", 112, 41],
    ["packages/server/src/write-queue.ts", 64, 0],
    ["packages/server/src/lru.ts", 31, 0],
  ];
  $("#paneBody").innerHTML =
    `<div class="pane-sum"><b>${current.add ? 4 : 0} files</b> <span class="add">+${current.add}</span> <span class="del">−${current.del}</span><button class="link">Keep all</button></div>` +
    (current.add
      ? files
          .map(
            (
              [f, a, d],
              fi,
            ) => `<div class="pfile"><div class="pfile-h"><span class="chev">▾</span>${f}<span class="add">+${a}</span><span class="del">−${d}</span></div>
    <div class="hunk">${["@@ -12,9 +12,11 @@", "  export function createSessionStore(db) {", "-   const cache = new Map();", "+   const cache = new LRU({ max: 500 });", "+   const writes = new WriteQueue(db);", "    return {"].map((l, i) => `<div class="dl ${l[0] === "+" ? "add" : l[0] === "-" ? "del" : l[0] === "@" ? "at" : "ctx"}" style="--i:${i + fi * 6}">${F.esc(l)}</div>`).join("")}
    <div class="hunk-act"><button>Keep</button><button>Reject</button><button>Comment → agent</button></div></div></div>`,
          )
          .join("")
      : '<div class="empty">No changes yet</div>');
}
function select(id) {
  current = F.sessions.find((s) => s.id === id);
  if (current.unread) current.unread = 0;
  F.swap(() => {
    renderSide();
    renderHead();
    renderPane();
    F.mountChat($("#chat"), current, ctx);
    document.body.dataset.mview = "chat";
  });
}

document.addEventListener("click", (e) => {
  const r = e.target.closest(".row");
  if (r) select(r.dataset.id);
  if (e.target.closest("#back")) document.body.dataset.mview = "list";
  if (e.target.closest("#openPal")) pal.open();
  if (e.target.closest("#togglePane")) document.body.classList.toggle("no-pane");
  if (e.target.closest(".dstrip-sum")) document.body.classList.toggle("sheet");
  const t = e.target.closest(".tabs button");
  if (t) {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b === t));
    moveInk();
  }
  const tool = e.target.closest(".tool-head");
  if (tool) tool.parentElement.classList.toggle("open");
});
function moveInk() {
  const on = $(".tabs .on"),
    ink = $(".tab-ink");
  ink.style.width = on.offsetWidth + "px";
  ink.style.transform = `translateX(${on.offsetLeft}px)`;
}

$("#composer").innerHTML = F.composerHTML();
F.wireComposer(document.body, ctx);
const pal = F.palette((s) => select(s.id));
renderSide();
renderHead();
renderPane();
F.mountChat($("#chat"), current, ctx);
moveInk();
if (!new URLSearchParams(location.search).get("m")) document.body.dataset.mview = "chat";
F.ambient((s) => {
  renderSide();
  const r = document.querySelector(`.row[data-id="${s.id}"]`);
  r && r.classList.add("pulse-once");
});
