const F = window.Frogg;
const $ = (s) => document.querySelector(s);
const proj = (s) => F.projects.find((p) => p.id === s.project);
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const fine = matchMedia("(pointer: fine)").matches;
const words = {
  permission: "needs you",
  running: "running",
  done: "done",
  error: "failed",
  idle: "idle",
};
const pill = (st) => `<span class="pill st-${st}">${words[st]}</span>`;
const filters = [
  ["all", "All"],
  ["permission", "Needs you"],
  ["running", "Running"],
  ["done", "Done"],
];
const match = (s, f) => f === "all" || s.status === f;
let filter = "all",
  cur = null;

function chips(el) {
  el.innerHTML = filters
    .map(([k, l]) => {
      const n = k === "all" ? F.sessions.length : F.sessions.filter((s) => s.status === k).length;
      return `<button data-f="${k}" aria-pressed="${filter === k}">${l}<span>${n}</span></button>`;
    })
    .join("");
}
// FLIP: elements glide to their new place instead of jumping (from the site's project filter).
function flip(container, sel, mutate) {
  const before = new Map(
    [...container.querySelectorAll(sel)].map((e) => [e.dataset.key, e.getBoundingClientRect()]),
  );
  mutate();
  if (reduce) return;
  container.querySelectorAll(sel).forEach((e) => {
    const a = before.get(e.dataset.key),
      b = e.getBoundingClientRect();
    e.animate(
      a
        ? [{ translate: `${a.left - b.left}px ${a.top - b.top}px` }, { translate: "0 0" }]
        : [
            { opacity: 0, scale: "0.96", filter: "blur(6px)" },
            { opacity: 1, scale: "1", filter: "none" },
          ],
      { duration: 550, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  });
}
function rows(c) {
  $("#rows").innerHTML = F.projects
    .map((p) => {
      const list = F.sessions.filter((s) => s.project === p.id && match(s, filter));
      if (!list.length) return "";
      return `<div class="grp" data-key="g-${p.id}"><div class="grp-h">${R3.projFacet(p.id, 16)}<span>${p.name}</span><i>${p.host}</i></div>${list
        .map(
          (
            s,
          ) => `<button class="row ${s.id === c.id ? "on" : ""}" data-id="${s.id}" data-key="${s.id}" data-spot style="--h1:${R3.hues[s.project][0]}">
            <span class="r1"><b>${F.esc(s.title)}</b>${s.unread ? `<span class="badge">${s.unread}</span>` : ""}</span>
            <span class="r2">${pill(s.status)}<span>${F.agents[s.agent].name} · ${s.ago}</span></span>
            ${s.status === "permission" ? `<span class="r3"><code>pnpm db:migrate</code><span class="qa" data-qa="${s.id}">Approve</span></span>` : ""}
          </button>`,
        )
        .join("")}</div>`;
    })
    .join("");
}
function grid(c) {
  $("#grid").innerHTML = F.sessions
    .filter((s) => match(s, filter))
    .map((s, i) => {
      const p = proj(s);
      const [h1, h2] = R3.hues[s.project];
      return `<article class="pcard ${s.id === c.id ? "on" : ""}" data-id="${s.id}" data-key="${s.id}" data-card style="--h1:${h1};--h2:${h2};--delay:${(i % 3) * 60}ms">
        <div class="glow"></div><div class="inner">
          <div class="top">${R3.facet(s.id, [h1, h2], 44)}<div class="badges">${pill(s.status)}<span class="lic">${p.name}</span></div></div>
          <h3>${F.esc(s.title)}</h3>
          <p class="tag">${F.agents[s.agent].name} · ${s.branch}</p>
          <p class="desc">${s.status === "permission" ? "Waiting for approval to run <code>pnpm db:migrate</code>." : s.status === "error" ? "Stopped: provider error after 3 retries." : s.status === "running" ? "Running tests: 142 so far, all passing." : s.status === "done" ? "Finished. Ready for review." : "Idle since " + s.ago + " ago."}</p>
          <div class="foot"><span class="stack">${s.add ? `<span class="add">+${s.add}</span><span class="del">−${s.del}</span>` : "<span>no changes</span>"}<span>${s.ago}</span></span>${s.status === "permission" ? `<span class="qa" data-qa="${s.id}">Approve</span>` : `<span class="visit">Open <span>↗</span></span>`}</div>
        </div></article>`;
    })
    .join("");
}
function render(c) {
  cur = c;
  chips($("#filters"));
  chips($("#filters2"));
  rows(c);
  grid(c);
}
function count(el) {
  el.querySelectorAll("[data-count]").forEach((d) => {
    const end = +d.dataset.count,
      t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 900);
      d.textContent = (d.dataset.prefix || "") + Math.round(end * (1 - Math.pow(1 - k, 4)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
function head(c) {
  const p = proj(c);
  $("#eyebrow").textContent = `${p.name} · ${c.branch}`;
  $("#title").innerHTML = F.esc(c.title);
  $("#pill").innerHTML = pill(c.status);
  $("#meta").textContent = `${F.agents[c.agent].name} · Opus 5.5 · ${p.host}`;
  $("#strip").innerHTML = c.add ? F.diffStripHTML(c) : "";
  $("#stats").innerHTML =
    `<dl><div><dt>Added</dt><dd class="add" data-count="${c.add}" data-prefix="+">0</dd></div><div><dt>Removed</dt><dd class="del" data-count="${c.del}" data-prefix="−">0</dd></div><div><dt>Files</dt><dd data-count="${c.add ? 4 : 0}">0</dd></div></dl>`;
  count($("#stats"));
  $("#changes").innerHTML = R3.changes(c).replace(/<div class="pane-actions">[\s\S]*$/, "");
  $("#ci").innerHTML = [
    "typecheck|done|42s",
    "lint|done|18s",
    "test (linux)|done|3m 12s",
    "desktop build|running|4m…",
    "android build|idle|queued",
  ]
    .map((r) => r.split("|"))
    .map(
      ([n, s, t]) =>
        `<div class="ci-r"><span class="cdot st-${s}"></span><span>${n}</span><i>${t}</i></div>`,
    )
    .join("");
}
document.addEventListener("click", (e) => {
  const f = e.target.closest("[data-f]");
  if (f) {
    filter = f.dataset.f;
    flip($("#rows"), "[data-key]", () => flip($("#grid"), "[data-key]", () => render(cur)));
  }
  const v = e.target.closest("[data-view-to]");
  if (v) setView(v.dataset.viewTo);
  if (e.target.closest(".pcard") && !e.target.closest("[data-qa]")) setView("session");
});
function setView(v) {
  F.swap(() => {
    document.body.dataset.view = v;
    document
      .querySelectorAll("[data-view-to]")
      .forEach((b) => b.classList.toggle("on", b.dataset.viewTo === v));
  });
}
// Card spotlight + tilt, straight from the site.
document.addEventListener("pointermove", (e) => {
  const card = e.target.closest("[data-card]");
  if (!card) return;
  const r = card.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width,
    y = (e.clientY - r.top) / r.height;
  card.style.setProperty("--mx", `${x * 100}%`);
  card.style.setProperty("--my", `${y * 100}%`);
  if (fine && !reduce) {
    card.style.setProperty("--rx", `${(0.5 - y) * 6}deg`);
    card.style.setProperty("--ry", `${(x - 0.5) * 6}deg`);
  }
});
document.addEventListener("pointerout", (e) => {
  const card = e.target.closest?.("[data-card]");
  if (card && !card.contains(e.relatedTarget)) {
    card.style.setProperty("--rx", "0deg");
    card.style.setProperty("--ry", "0deg");
  }
});
// The hero band collapses as the conversation scrolls.
$("#scroll").addEventListener("scroll", (e) => {
  document.body.classList.toggle("compact", e.target.scrollTop > 40);
});
R3.spotlight(document.body);
try {
  Terrain.mountFacets($("#facets"));
} catch (err) {
  console.warn("terrain disabled", err);
}
Kit({
  render,
  head,
  placeholder: "Message Claude Code — ⏎ to steer, ⌘⏎ to queue, / for commands",
  onEvent: (s) => document.querySelector(`.row[data-id="${s.id}"]`)?.classList.add("ping"),
});
