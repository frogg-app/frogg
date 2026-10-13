const F = window.Frogg;
const $ = (s) => document.querySelector(s);
// Each project is a line with a fixed colour and letter; sessions are stations on it.
const lines = {
  frogg: { c: "#00843d", l: "F" },
  billing: { c: "#e87722", l: "B" },
  docs: { c: "#0072bc", l: "D" },
  infra: { c: "#8e3b96", l: "I" },
};
const proj = (s) => F.projects.find((p) => p.id === s.project);
const note = {
  permission: "Hold — needs you",
  error: "Station closed",
  running: "Train approaching",
  done: "Arrived",
  idle: "",
};
function render(cur) {
  $("#map").innerHTML = F.projects
    .map((p) => {
      const L = lines[p.id];
      const list = F.sessions.filter((s) => s.project === p.id);
      return `<section class="line" style="--lc:${L.c}">
        <h3><span class="bullet">${L.l}</span>${p.name}<small>${p.host}</small></h3>
        <ol>${list
          .map(
            (
              s,
            ) => `<li><button class="stn st-${s.status} ${s.id === cur.id ? "here" : ""}" data-id="${s.id}">
              <span class="mk"></span>${s.status === "running" ? '<span class="train"></span>' : ""}
              <span class="nm">${F.esc(s.title)}</span>
              <span class="sub">${note[s.status] ? `<b>${note[s.status]}</b> · ` : ""}${F.agents[s.agent].short} · ${s.ago}${s.unread ? ` · ${s.unread} new` : ""}</span>
              ${s.status === "permission" ? `<span class="ask"><code>pnpm db:migrate</code> <span class="qa" data-qa="${s.id}">Proceed</span></span>` : ""}
              ${s.id === cur.id ? '<span class="yah">You are here</span>' : ""}
            </button></li>`,
          )
          .join("")}</ol></section>`;
    })
    .join("");
  const waiting = F.sessions.filter((s) => s.status === "permission");
  const run = F.sessions.filter((s) => s.status === "running");
  $("#dep").innerHTML = [
    ...waiting.map(
      (s) =>
        `<span class="row hold"><span class="bullet" style="--lc:${lines[s.project].c}">${lines[s.project].l}</span><b>${F.esc(s.title)}</b><span class="when">HOLD</span></span>`,
    ),
    ...run.map(
      (s) =>
        `<span class="row"><span class="bullet" style="--lc:${lines[s.project].c}">${lines[s.project].l}</span><b>${F.esc(s.title)}</b><span class="when">${s.ago === "now" ? "due" : s.ago}</span></span>`,
    ),
  ]
    .slice(0, 4)
    .join("");
}
function head(cur) {
  const p = proj(cur);
  const L = lines[cur.project];
  document.querySelector(".ride").style.setProperty("--lc", L.c);
  $("#badge").innerHTML =
    `<span class="bullet">${L.l}</span>${p.name} line · towards <code>${cur.branch}</code>`;
  $("#title").textContent = cur.title;
  $("#meta").innerHTML =
    `${F.agents[cur.agent].name} · ${p.host} · ${F.statusLabel[cur.status]}${cur.add ? ` · <span class="add">+${cur.add}</span> <span class="del">−${cur.del}</span>` : ""}`;
  $("#strip").innerHTML = cur.add ? F.diffStripHTML(cur) : "";
}
Kit({
  render,
  head,
  placeholder: "Message the driver…  ⏎ steer · ⌘⏎ queue",
  onEvent: (s) => document.querySelector(`.stn[data-id="${s.id}"]`)?.classList.add("arrive"),
});
