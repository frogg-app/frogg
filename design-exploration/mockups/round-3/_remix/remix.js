/* Round-3 remix kit: every part from the top-row directions, rendered into whichever
   containers a layout provides (#rail, #fleet, #rows, #tree, #tabs, #status, #paneBody,
   #panelBody, #crumb/#title/#meta, #chat2). Layouts are just HTML + CSS. */
(function () {
  const F = window.Frogg;
  const $ = (s) => document.querySelector(s);
  const proj = (s) => F.projects.find((p) => p.id === s.project);
  const order = [
    ["permission", "Needs you"],
    ["error", "Failed"],
    ["done", "Ready to review"],
    ["running", "Working"],
    ["idle", "Idle"],
  ];
  const st = {
    scope: "all",
    pane: "changes",
    open: ["s1", "s2", "s7"],
    seen: new Set(),
    closed: new Set(["infra"]),
    cur: null,
  };
  const inScope = (s) =>
    st.scope === "all"
      ? true
      : st.scope === "need"
        ? s.status === "permission" || s.status === "error"
        : s.project === st.scope;
  const ICON = {
    all: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>',
    need: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  };
  const svg = (d) =>
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">${d}</svg>`;

  function rail() {
    const need = F.sessions.filter((s) => s.status === "permission" || s.status === "error").length;
    const item = (k, inner, label, badge) =>
      `<button class="ri ${st.scope === k ? "on" : ""}" data-scope="${k}" aria-label="${label}">${inner}${badge ? `<span class="rb">${badge}</span>` : ""}<span class="tip">${label}</span></button>`;
    return (
      `<div class="logo" title="frogg">${R3.facet("frogg-brand", ["#7fd9e6", "#045b9d"], 26)}</div>` +
      item("all", svg(ICON.all), "All sessions") +
      item("need", svg(ICON.need), "Needs you", need) +
      '<span class="rsep"></span>' +
      F.projects
        .map((p) => {
          const live = F.sessions.some((s) => s.project === p.id && s.status === "running");
          return item(
            p.id,
            R3.projFacet(p.id, 26) + (live ? '<span class="live"></span>' : ""),
            `${p.name} · ${p.host}`,
          );
        })
        .join("") +
      '<button class="ri add" aria-label="Add project">+</button><span class="rfill"></span>' +
      `<button class="ri" aria-label="Settings">${svg(ICON.settings)}<span class="tip">Settings</span></button>`
    );
  }
  function fleet() {
    const n = (k) => F.sessions.filter((s) => s.status === k && inScope(s)).length;
    return (
      `<span class="segs">${order.map(([k]) => `<span class="seg seg-${k}" style="flex:${n(k)}"></span>`).join("")}</span>` +
      `<span class="fleet-l">${order
        .filter(([k]) => n(k))
        .map(([k, l]) => `<span>${R3.glyph(k)}<b>${n(k)}</b> ${l.toLowerCase()}</span>`)
        .join("")}</span>`
    );
  }
  function inbox(c, compact) {
    return (
      order
        .map(([k, label]) => {
          const list = F.sessions.filter((s) => s.status === k && inScope(s));
          if (!list.length) return "";
          return `<div class="sec sec-${k}"><span>${label}</span><i>${list.length}</i></div>${list
            .map((s) => {
              const p = proj(s);
              return `<button class="row st-${s.status} ${s.id === c.id ? "on" : ""}" data-id="${s.id}" data-spot>
              <span class="r1">${R3.glyph(s.status)}<b>${F.esc(s.title)}</b>${s.unread ? `<span class="u">${s.unread}</span>` : ""}<span class="ago">${s.ago}</span></span>
              ${compact ? "" : `<span class="r2">${R3.projFacet(p.id, 11)}<span>${p.name}</span><span class="br">${s.branch}</span>${s.add ? `<span class="d"><span class="add">+${s.add}</span> <span class="del">−${s.del}</span></span>` : ""}</span>`}
              ${s.status === "permission" ? `<span class="r3"><span class="cmd"><code>pnpm db:migrate --env staging</code></span><span class="qa" data-qa="${s.id}">Approve <kbd>A</kbd></span></span>` : ""}
              ${s.status === "error" && !compact ? `<span class="r3 e">${s.id === "s12" ? "terraform plan · host unreachable" : "exit 1 · retry.test.ts › backs off on 429"}</span>` : ""}
            </button>`;
            })
            .join("")}`;
        })
        .join("") || `<div class="none">Nothing here.</div>`
    );
  }
  function tree(c) {
    const need = F.sessions.filter(
      (s) => (s.status === "permission" || s.status === "error") && inScope(s),
    );
    const node = (
      s,
      d,
    ) => `<button class="node st-${s.status} ${s.id === c.id ? "on" : ""}" data-id="${s.id}" data-spot style="--d:${d}">
      ${R3.glyph(s.status)}<span class="nt">${F.esc(s.title)}</span>${s.unread ? `<span class="u">${s.unread}</span>` : `<span class="ag">${F.agents[s.agent].short}</span>`}</button>`;
    return (
      (need.length
        ? `<div class="sect"><span>Attention</span><i>${need.length}</i></div>${need.map((s) => node(s, 0)).join("")}`
        : "") +
      `<div class="sect"><span>Projects</span></div>` +
      F.projects
        .filter((p) => st.scope === "all" || st.scope === "need" || st.scope === p.id)
        .map((p) => {
          const list = F.sessions.filter((s) => s.project === p.id);
          const shut = st.closed.has(p.id) && st.scope !== p.id;
          return `<button class="folder ${shut ? "shut" : ""}" data-fold="${p.id}"><span class="caret">›</span>${R3.projFacet(p.id, 13)}<span>${p.name}</span><i>${p.host}</i></button>${shut ? "" : list.map((s) => node(s, 1)).join("")}`;
        })
        .join("")
    );
  }
  function tabs(c) {
    if (!st.open.includes(c.id)) st.open.push(c.id);
    return (
      st.open
        .map((id) => {
          const s = F.sessions.find((x) => x.id === id);
          const fresh = st.seen.has(id) ? "" : "fresh";
          st.seen.add(id);
          return `<button class="tab ${fresh} ${id === c.id ? "on" : ""}" data-id="${id}">${R3.glyph(s.status)}<span>${F.esc(s.title)}</span><span class="x" data-close="${id}">×</span></button>`;
        })
        .join("") + `<span class="tab-fill"></span>`
    );
  }
  function status(c) {
    const needs = F.sessions.filter((s) => s.status === "permission");
    const run = F.sessions.filter((s) => s.status === "running").length;
    return `<span class="sb brand">${R3.facet("frogg-sb", ["#7fd9e6", "#045b9d"], 12)}frogg</span><span class="sb">${R3.glyph("done")} devbox</span><span class="sb mono">⎇ ${c.branch}</span><span class="sb">${c.add ? `<span class="add">+${c.add}</span> <span class="del">−${c.del}</span>` : "clean"}</span>
      <span class="sp"></span>${needs.length ? `<button class="sb warn" data-id="${needs[0].id}">${R3.glyph("permission")} ${needs.length} need you</button>` : ""}<span class="sb">${R3.glyph("running")} ${run} running</span>
      <span class="sb">${F.agents[c.agent].name} · Opus 5.5</span><span class="sb rings">${F.ring(42, "5h", 16)}${F.ring(86, "wk", 16)}${F.ring(23, "ctx", 16)}</span><button class="sb" data-pal>⌘K</button>`;
  }
  function pane(c) {
    if (st.pane === "terminal") return R3.terminal();
    if (st.pane === "ci")
      return `<div class="ci">${[
        "typecheck|done|42s",
        "lint|done|18s",
        "test (linux)|done|3m 12s",
        "desktop build|running|4m…",
        "android build|idle|queued",
      ]
        .map((r) => r.split("|"))
        .map(([n, s, t]) => `<div class="ci-r">${R3.glyph(s)}<span>${n}</span><i>${t}</i></div>`)
        .join("")}</div>`;
    return R3.changes(c);
  }
  const glides = [
    ["#list", "#brk", ".row.on"],
    ["#tree", "#notch", ".node.on"],
    ["#paneTabs", "#paneInd", "button.on"],
  ];
  const reglide = () => glides.forEach(([b, i, s]) => $(b) && $(i) && R3.glide($(b), $(i), s));
  function render(c) {
    st.cur = c;
    if ($("#rail")) $("#rail").innerHTML = rail();
    if ($("#fleet")) $("#fleet").innerHTML = fleet();
    if ($("#rows")) $("#rows").innerHTML = inbox(c, document.body.dataset.compact === "1");
    if ($("#treeRows")) $("#treeRows").innerHTML = tree(c);
    if ($("#tabs")) $("#tabs").innerHTML = tabs(c);
    if ($("#status")) {
      $("#status").innerHTML = status(c);
      F.animateRings($("#status"));
    }
    if ($("#scopeName"))
      $("#scopeName").innerHTML =
        st.scope === "all"
          ? "All sessions"
          : st.scope === "need"
            ? "Needs you"
            : `${R3.projFacet(st.scope, 15)}${F.projects.find((p) => p.id === st.scope).name}`;
    requestAnimationFrame(reglide);
  }
  function head(c) {
    const p = proj(c);
    if ($("#crumb"))
      $("#crumb").innerHTML =
        `${R3.projFacet(p.id, 12)}<span>${p.host}</span><i>/</i><span>${p.name}</span><i>/</i><b>${c.branch}</b>`;
    if ($("#title")) $("#title").textContent = c.title;
    if ($("#meta"))
      $("#meta").innerHTML =
        `${R3.glyph(c.status)}<span>${F.statusLabel[c.status]}</span><span>${F.agents[c.agent].name}</span><span>Opus 5.5</span>`;
    if ($("#chgN")) $("#chgN").textContent = c.add ? `+${c.add} −${c.del}` : "";
    if ($("#strip")) $("#strip").innerHTML = c.add ? F.diffStripHTML(c) : "";
    if ($("#paneBody")) $("#paneBody").innerHTML = pane(c);
    if ($("#panelBody")) $("#panelBody").innerHTML = R3.terminal();
  }
  function paintPane() {
    document
      .querySelectorAll("#paneTabs [data-pane]")
      .forEach((b) => b.classList.toggle("on", b.dataset.pane === st.pane));
    if ($("#paneBody")) $("#paneBody").innerHTML = pane(st.cur);
    document.body.classList.add("pane-open");
    requestAnimationFrame(reglide);
  }
  document.addEventListener("click", (e) => {
    const sc = e.target.closest("[data-scope]");
    if (sc) {
      st.scope = sc.dataset.scope;
      render(st.cur);
    }
    const f = e.target.closest("[data-fold]");
    if (f) {
      const k = f.dataset.fold;
      st.closed.has(k) ? st.closed.delete(k) : st.closed.add(k);
      render(st.cur);
    }
    const x = e.target.closest("[data-close]");
    if (x) {
      e.stopPropagation();
      st.open = st.open.filter((i) => i !== x.dataset.close);
      if (!st.open.length) st.open = ["s1"];
      if (st.cur.id === x.dataset.close)
        document.querySelector(`.tab[data-id="${st.open[0]}"]`)?.click();
      else render(st.cur);
    }
    const pt = e.target.closest("[data-pane]");
    if (pt) {
      st.pane = pt.dataset.pane;
      paintPane();
    }
    if (e.target.closest("[data-pane-close]")) document.body.classList.remove("pane-open");
    if (e.target.closest("[data-panel-toggle]")) document.body.classList.toggle("panel-min");
    if (e.target.closest(".dstrip-sum")) {
      st.pane = "changes";
      paintPane();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.isContentEditable || e.target.tagName === "INPUT") return;
    if (e.key === "a" && st.cur.status === "permission")
      document.querySelector(`[data-qa="${st.cur.id}"]`)?.click();
    if (e.key === "`") document.body.classList.toggle("panel-min");
    if (e.key === "\\") document.body.classList.toggle("pane-open");
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= 9 && document.querySelectorAll(".tab")[n - 1])
      document.querySelectorAll(".tab")[n - 1].click();
  });
  addEventListener("resize", reglide);
  R3.spotlight(document.body);
  window.Remix = function (opts = {}) {
    const k = Kit({
      render,
      head,
      placeholder:
        opts.placeholder || "Message Claude Code — ⏎ to steer, ⌘⏎ to queue, / for commands",
      onEvent: (s) =>
        document.querySelector(`[data-id="${s.id}"]:not(.tab)`)?.classList.add("ping"),
    });
    if ($("#chat2")) {
      const s2 = F.sessions.find((s) => s.id === (opts.second || "s7"));
      const ctx2 = { container: $("#chat2"), scroller: $("#scroll2") };
      F.mountChat($("#chat2"), s2, ctx2);
      const p = proj(s2);
      $("#title2").textContent = s2.title;
      $("#crumb2").innerHTML =
        `${R3.projFacet(p.id, 12)}<span>${p.name}</span><i>/</i><b>${s2.branch}</b>`;
      $("#composer2").innerHTML = F.composerHTML({
        placeholder: `Message ${F.agents[s2.agent].name}…`,
      });
    }
    return k;
  };
})();
