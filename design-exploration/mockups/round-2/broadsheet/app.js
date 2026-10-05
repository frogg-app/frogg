const F = window.Frogg;
const $ = (s) => document.querySelector(s);
const desks = [
  ["permission", "Stop press", "Agents awaiting your word"],
  ["error", "Corrections", "Runs that went to press wrong"],
  ["done", "Filed", "Unread copy on your desk"],
  ["running", "Developing", "Stories being written now"],
  ["idle", "Archive", "Quiet desks"],
];
const proj = (s) => F.projects.find((p) => p.id === s.project);
$("#dateline").textContent =
  new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }) + " · Thirteen sessions in print";
function render(cur) {
  $("#front").innerHTML = desks
    .map(([k, name, sub]) => {
      const list = F.sessions.filter((s) => s.status === k);
      if (!list.length) return "";
      return `<section class="desk desk-${k}"><h3>${name}<small>${sub}</small></h3>${list
        .map(
          (
            s,
            i,
          ) => `<button class="story ${s.id === cur.id ? "on" : ""} ${i === 0 && k === "permission" ? "lead" : ""}" data-id="${s.id}">
            <span class="hl">${F.esc(s.title)}</span>
            <span class="dek">${proj(s).name} — ${F.agents[s.agent].name}, ${s.ago === "now" ? "this minute" : s.ago + " ago"}${s.unread ? ` · <b>${s.unread} new</b>` : ""}</span>
            ${k === "permission" ? `<span class="ask">Seeks leave to run <code>pnpm db:migrate</code>. <span class="qa" data-qa="${s.id}">Grant</span></span>` : ""}
          </button>`,
        )
        .join("")}</section>`;
    })
    .join("");
}
function head(cur) {
  const p = proj(cur);
  $("#kicker").textContent = desks.find((d) => d[0] === cur.status)[1];
  $("#headline").textContent = cur.title;
  $("#byline").innerHTML =
    `By <b>${F.agents[cur.agent].name}</b> · ${p.name} desk, ${p.host} · <code>${cur.branch}</code>`;
  $("#strip").innerHTML = cur.add ? F.diffStripHTML(cur) : "";
  $("#brief").innerHTML = `<h4>In brief</h4>
    <dl><dt>Lines set</dt><dd><span class="add">+${cur.add}</span></dd><dt>Lines cut</dt><dd><span class="del">−${cur.del}</span></dd>
    <dt>Pull request</dt><dd>#412, open</dd><dt>CI</dt><dd>3 of 5 pass</dd><dt>Model</dt><dd>Opus 5.5 · high</dd><dt>Context</dt><dd>23%</dd></dl>
    <h4>Market</h4><table>${[
      "5h quota|42%|▲",
      "Weekly|86%|▲",
      "Tokens today|1.2M|▲",
      "Cost|$4.10|▼",
    ]
      .map(
        (r) =>
          `<tr>${r
            .split("|")
            .map((c) => `<td>${c}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</table>
    <h4>Weather</h4><p class="wx">devbox fair, load 0.8 · macbook fair · ci-runner-2 <em>stormy, unreachable since 09:12</em></p>`;
}
Kit({
  render,
  head,
  placeholder: "Dictate to the desk…  ⏎ steer · ⌘⏎ queue",
  onEvent: (s) => document.querySelector(`.story[data-id="${s.id}"]`)?.classList.add("flash"),
});
