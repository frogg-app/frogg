const F = window.Frogg;
const $ = (s) => document.querySelector(s);
const proj = (s) => F.projects.find((p) => p.id === s.project);
let filter = "all",
  tab = "changes",
  cur = null;
const filters = [
  ["all", "All"],
  ["permission", "Needs you"],
  ["running", "Running"],
  ["done", "Unread"],
];
$("#brand").innerHTML = R3.facet("frogg-brand", ["#7fd9e6", "#045b9d"], 22) + "<span>frogg</span>";
function render(c) {
  cur = c;
  $("#filters").innerHTML = filters
    .map(([k, l]) => {
      const n = k === "all" ? F.sessions.length : F.sessions.filter((s) => s.status === k).length;
      return `<button class="${filter === k ? "on" : ""} f-${k}" data-f="${k}">${l}<span>${n}</span></button>`;
    })
    .join("");
  $("#rows").innerHTML = F.projects
    .map((p) => {
      const list = F.sessions.filter(
        (s) => s.project === p.id && (filter === "all" || s.status === filter),
      );
      if (!list.length) return "";
      return `<div class="grp"><div class="grp-h">${R3.projFacet(p.id, 14)}<span>${p.name}</span><i>${p.host}</i></div>${list
        .map(
          (
            s,
            i,
          ) => `<button class="row st-${s.status} ${s.id === c.id ? "on" : ""}" data-id="${s.id}" data-spot style="--i:${i}">
            ${R3.glyph(s.status)}
            <span class="rt"><b>${F.esc(s.title)}</b><i>${s.status === "permission" ? '<em class="needs">Needs approval</em> · ' : s.status === "error" ? '<em class="err">Failed</em> · ' : ""}${F.agents[s.agent].name} · ${s.ago}</i></span>
            <span class="rr">${s.unread ? `<span class="badge">${s.unread}</span>` : s.add ? `<span class="add">+${s.add}</span>` : ""}</span>
          </button>`,
        )
        .join("")}</div>`;
    })
    .join("");
  requestAnimationFrame(() => R3.glide($("#list"), $("#plate"), ".row.on"));
  setTimeout(() => $("#list").classList.add("ready"), 900);
}
function head(c) {
  const p = proj(c);
  $("#crumbs").innerHTML =
    `<span>${p.host}</span><i>/</i><span>${p.name}</span><i>/</i><b>${c.branch}</b>`;
  $("#title").textContent = c.title;
  $("#meta").innerHTML =
    `${R3.glyph(c.status)}<span>${F.statusLabel[c.status]}</span><span>${F.agents[c.agent].name} · Opus 5.5</span><span>worktree</span>`;
  $("#chgN").textContent = c.add ? 4 : "";
  $("#strip").innerHTML = c.add ? F.diffStripHTML(c) : "";
  paintPane();
}
function paintPane() {
  $("#paneBody").innerHTML =
    tab === "changes"
      ? R3.changes(cur)
      : tab === "terminal"
        ? R3.terminal()
        : `<div class="ci">${[
            "typecheck|done|42s",
            "lint|done|18s",
            "test (linux)|done|3m 12s",
            "desktop build|running|4m…",
            "android build|idle|queued",
          ]
            .map((r) => r.split("|"))
            .map(
              ([n, s, t], i) =>
                `<div class="ci-r" style="--i:${i}">${R3.glyph(s)}<span>${n}</span><i>${t}</i></div>`,
            )
            .join("")}</div>`;
  document
    .querySelectorAll("#tabs button")
    .forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  requestAnimationFrame(() => R3.glide($("#tabs"), $("#tabInd"), "button.on"));
}
document.addEventListener("click", (e) => {
  const f = e.target.closest("[data-f]");
  if (f) {
    filter = f.dataset.f;
    render(cur);
  }
  const t = e.target.closest("[data-tab]");
  if (t) {
    tab = t.dataset.tab;
    paintPane();
  }
});
R3.spotlight(document.body);
Kit({
  render,
  head,
  placeholder: "Message Claude Code — ⏎ to steer, ⌘⏎ to queue, / for commands",
  onEvent: (s) => document.querySelector(`.row[data-id="${s.id}"]`)?.classList.add("ping"),
});
addEventListener("resize", () => R3.glide($("#list"), $("#plate"), ".row.on"));
