const F = window.Frogg;
const $ = (s) => document.querySelector(s);
// Each project is a divider with its own manila tint and tab offset, like a real drawer.
const tint = { frogg: "#e9d9a6", billing: "#d9e3c2", docs: "#e6cdbf", infra: "#cfd8de" };
const tabPos = { frogg: 0, billing: 1, docs: 2, infra: 3 };
const tag = {
  permission: '<span class="flag flag-permission">sign</span>',
  error: '<span class="flag flag-error">torn</span>',
  done: '<span class="flag flag-done">new</span>',
  running: '<span class="flag flag-running">out</span>',
  idle: "",
};
const proj = (s) => F.projects.find((p) => p.id === s.project);
function render(cur) {
  $("#drawer").innerHTML = F.projects
    .map((p) => {
      const list = F.sessions.filter((s) => s.project === p.id);
      return `<section class="divider" style="--tint:${tint[p.id]};--tab:${tabPos[p.id]}">
        <div class="tab"><b>${p.name}</b><small>${p.host} · ${list.length}</small></div>
        <div class="cards">${list
          .map(
            (
              s,
            ) => `<button class="card st-${s.status} ${s.id === cur.id ? "on" : ""}" data-id="${s.id}">
              <span class="hole"></span>
              <span class="t">${F.esc(s.title)}</span>
              <span class="sub">${s.branch} · ${F.agents[s.agent].short} · ${s.ago}${s.unread ? ` · ${s.unread} unread` : ""}</span>
              ${tag[s.status]}
              ${s.status === "permission" ? `<span class="ask">wants <code>pnpm db:migrate</code> <span class="qa" data-qa="${s.id}">OK</span></span>` : ""}
            </button>`,
          )
          .join("")}</div></section>`;
    })
    .join("");
}
function head(cur) {
  const p = proj(cur);
  $("#callno").textContent =
    `${p.name.slice(0, 3).toUpperCase()} ${String(F.sessions.indexOf(cur) + 1).padStart(3, "0")}.${cur.agent.slice(0, 2).toUpperCase()}`;
  $("#title").textContent = cur.title;
  $("#meta").innerHTML =
    `${F.agents[cur.agent].name} · ${p.name} on ${p.host} · <code>${cur.branch}</code>${cur.add ? ` · <span class="add">+${cur.add}</span> <span class="del">−${cur.del}</span>` : ""}`;
  $("#clip").innerHTML = tag[cur.status];
  $("#strip").innerHTML = cur.add ? F.diffStripHTML(cur) : "";
  document.querySelector(".card-main").style.setProperty("--tint", tint[cur.project]);
}
Kit({
  render,
  head,
  placeholder: "Type a note on the card…  ⏎ steer · ⌘⏎ queue",
  onEvent: (s) => document.querySelector(`.card[data-id="${s.id}"]`)?.classList.add("nudge"),
});
