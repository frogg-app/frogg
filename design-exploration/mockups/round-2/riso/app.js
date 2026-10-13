const F = window.Frogg;
const $ = (s) => document.querySelector(s);
const rank = { permission: 0, error: 1, running: 2, done: 3, idle: 4 };
const proj = (s) => F.projects.find((p) => p.id === s.project);
const word = { permission: "ASK", error: "ERR", running: "RUN", done: "DONE", idle: "zzz" };
function render(cur) {
  const list = [...F.sessions].sort((a, b) => rank[a.status] - rank[b.status]);
  $("#strip-s").innerHTML = list
    .map(
      (
        s,
      ) => `<button class="poster h-${s.status} ${s.id === cur.id ? "on" : ""}" data-id="${s.id}" style="--tilt:${((s.id.length * 7 + s.add) % 5) - 2}deg">
        <span class="ink-a">${word[s.status]}</span>
        <span class="t">${F.esc(s.title)}</span>
        <span class="m">${proj(s).name} · ${F.agents[s.agent].short} · ${s.ago}</span>
        ${s.status === "permission" ? `<span class="qa" data-qa="${s.id}">YES, RUN IT</span>` : ""}
        ${s.unread ? `<span class="badge">${s.unread}</span>` : ""}
      </button>`,
    )
    .join("");
}
function head(cur) {
  const p = proj(cur);
  $("#bigno").textContent = String(F.sessions.indexOf(cur) + 1).padStart(2, "0");
  $("#bigno").className = `big-no h-${cur.status}`;
  $("#title").textContent = cur.title;
  $("#meta").innerHTML =
    `${F.statusLabel[cur.status].toUpperCase()} / ${p.name} @ ${p.host} / ${cur.branch} / ${F.agents[cur.agent].name}`;
  $("#strip").innerHTML = cur.add ? F.diffStripHTML(cur) : "";
}
Kit({
  render,
  head,
  placeholder: "Say something…  ⏎ steer · ⌘⏎ queue",
  onEvent: (s) => {
    const el = document.querySelector(`.poster[data-id="${s.id}"]`);
    el &&
      (el.classList.add("slap"),
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }));
  },
});
