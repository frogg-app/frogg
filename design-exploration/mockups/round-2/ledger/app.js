const F = window.Frogg;
const $ = (s) => document.querySelector(s);
const stampText = {
  permission: "SIGN HERE",
  error: "RETURNED",
  done: "POSTED",
  running: "IN PROGRESS",
  idle: "ON FILE",
};
const rank = { permission: 0, error: 1, done: 2, running: 3, idle: 4 };
const proj = (s) => F.projects.find((p) => p.id === s.project);
const stamp = (st, big) =>
  `<span class="stamp st-${st} ${big ? "big" : ""}" style="--r:${(st.length % 5) - 2.5}deg">${stampText[st]}</span>`;
function render(cur) {
  const list = [...F.sessions].sort((a, b) => rank[a.status] - rank[b.status]);
  $("#rows").innerHTML = list
    .map(
      (
        s,
        i,
      ) => `<button class="row ${s.id === cur.id ? "on" : ""} st-${s.status}" data-id="${s.id}">
      <span class="no">${String(i + 1).padStart(3, "0")}</span>
      <span class="ent"><b>${F.esc(s.title)}</b><i>${proj(s).name} / ${s.branch} · ${F.agents[s.agent].short} · ${s.ago}</i>
        ${s.status === "permission" ? `<span class="ask">req. <code>pnpm db:migrate</code> <span class="qa" data-qa="${s.id}">initial ✍</span></span>` : ""}</span>
      <span class="dr">${s.add ? s.add : ""}</span><span class="cr">${s.del ? s.del : ""}</span>
      <span class="sst">${stamp(s.status)}</span>
      ${s.id === cur.id ? '<svg class="hl" viewBox="0 0 300 30" preserveAspectRatio="none"><path d="M2 18 C 60 8, 140 22, 298 12 L 296 26 C 160 30, 70 20, 4 28 Z"/></svg>' : ""}
    </button>`,
    )
    .join("");
  const a = F.sessions.reduce((n, s) => n + s.add, 0),
    d = F.sessions.reduce((n, s) => n + s.del, 0);
  $("#totals").innerHTML =
    `<span>CARRIED FORWARD · ${F.sessions.length} accounts</span><span class="dr">${a}</span><span class="cr">${d}</span><span class="net">net +${a - d}</span>`;
}
function head(cur) {
  const p = proj(cur);
  $("#acct").innerHTML =
    `ACCT ${p.name.toUpperCase()} · ${cur.branch} · ${F.agents[cur.agent].name.toUpperCase()} @ ${p.host}`;
  $("#title").textContent = cur.title;
  $("#stamp").innerHTML = stamp(cur.status, true);
  $("#strip").innerHTML = cur.add ? F.diffStripHTML(cur) : "";
}
Kit({
  render,
  head,
  placeholder: "Write an entry…  ⏎ steer · ⌘⏎ queue",
  onEvent: (s) => {
    const r = document.querySelector(`.row[data-id="${s.id}"] .stamp`);
    r && r.classList.add("thunk");
  },
  onState: (st, cur) => {
    if (cur.id !== "s1") return;
    cur.status = st === "permission" ? "permission" : st === "idle" ? "done" : "running";
    $("#stamp").innerHTML = stamp(cur.status, true);
    $("#stamp .stamp").classList.add("thunk");
  },
});
