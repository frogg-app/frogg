/* Round-4 shell: tool rail, side panel, main area, status bar, palette, ?state= routing. */
const F = Frogg;
const { ic, esc } = U;
window.S = {
  tool: "sessions",
  cur: "s1",
  scope: "all",
  open: ["s1", "s2", "s7"],
  page: "appearance",
  drawer: false,
  host: "devbox",
};
const $ = (q) => document.querySelector(q);
const MKEEP = ["sessions", "inbox", "search", "scm", "settings"];

function rail() {
  return (
    `<div class="logo" title="frogg">${R3.facet("frogg-brand", ["#7fd9e6", "#045b9d"], 24)}</div><span class="rind" id="rind"></span>` +
    Tools.list
      .map((t) => {
        if (t === "-") return '<span class="rsep"></span>';
        if (t === "fill") return '<span class="rfill"></span>';
        if (t === "plugins") return '<span class="rsep plug" title="Added by plugins"></span>';
        const b = t.badge ? t.badge() : 0;
        const inner = t.plugin ? R3.facet(t.plugin[0], t.plugin[1], 20) : ic(t.ic, 19);
        return `<button class="ri ${S.tool === t.id ? "on" : ""} ${MKEEP.includes(t.id) ? "m-keep" : ""} ${t.plugin ? "plug" : ""}" data-tool="${t.id}" ${t.act ? `data-act="${t.act}"` : ""} aria-label="${t.label}">${inner}${b ? `<span class="rb ${t.dim ? "dim" : t.bad ? "bad" : ""}">${b}</span>` : ""}${t.warn ? '<span class="rw"></span>' : ""}${t.id === "sessions" && F.sessions.some((s) => s.status === "running") ? '<span class="live"></span>' : ""}<span class="tip">${t.label}${t.k ? ` <kbd>${t.k}</kbd>` : ""}</span><span class="ml">${t.label.split(" ")[0]}</span></button>`;
      })
      .join("") +
    `<button class="ri m-more" data-act="m-more" aria-label="More tools">${ic("more", 19)}<span class="ml">More</span></button>`
  );
}
function status() {
  const s = F.sessions.find((x) => x.id === S.cur);
  const needs = F.sessions.filter((x) => x.status === "permission").length;
  const run = F.sessions.filter((x) => x.status === "running").length;
  return `<span class="sb brand">${R3.facet("frogg-sb", ["#7fd9e6", "#045b9d"], 12)}frogg</span><button class="sb" data-tool="hosts">${R3.glyph("done")} devbox <span class="mut">· 2 of 3 hosts</span></button><button class="sb mono" data-tool="scm">⎇ ${s.branch} ↑3</button><span class="sb">${s.add ? `<span class="add">+${s.add}</span> <span class="del">−${s.del}</span>` : "clean"}</span><button class="sb" data-tool="prs">${R3.glyph("running")} checks 3/5</button>
  <span class="sp"></span>${needs ? `<button class="sb warn" data-id="s2">${R3.glyph("permission")} ${needs} need you</button>` : ""}<span class="sb">${R3.glyph("running")} ${run} running</span><button class="sb" data-tool="usage">${F.agents[s.agent].name} · Opus 5.5 <span class="rings">${F.ring(42, "5h", 16)}${F.ring(86, "wk", 16)}</span></button><button class="sb" data-tool="inbox">${ic("inbox", 12)} 4</button><button class="sb" data-pal>⌘K</button><a class="sb" href="../index.html">← gallery</a>`;
}
function render() {
  const t = Tools.get(S.tool);
  document.body.dataset.view = S.tool;
  $("#rail").innerHTML = rail();
  $("#side").innerHTML = S.sideHTML || t.side(S);
  $("#main").innerHTML = S.mainHTML || t.main(S);
  $("#status").innerHTML = status();
  F.animateRings(document.body);
  document.body.classList.toggle("drawer", !!S.drawer);
  requestAnimationFrame(reglide);
  const sc = $("#scroll");
  if (sc) sc.scrollTop = S.scrollTop != null ? S.scrollTop : 1e6;
}
function reglide() {
  document.querySelectorAll("[data-glide]").forEach((l) => {
    const b = l.querySelector(".brk");
    if (b) R3.glide(l, b, ".on");
  });
  const r = $("#rail .ri.on"),
    ind = $("#rind");
  if (r && ind) {
    ind.style.opacity = 1;
    ind.style.transform = `translateY(${r.offsetTop}px)`;
    ind.style.height = r.offsetHeight + "px";
  } else if (ind) ind.style.opacity = 0;
}
function go(tool, extra = {}) {
  Object.assign(S, { sideHTML: null, mainHTML: null }, extra, { tool });
  document.body.dataset.mview = extra.mview || "main";
  render();
}
function select(id) {
  const s = F.sessions.find((x) => x.id === id);
  if (!s) return;
  if (!S.open.includes(id)) S.open.push(id);
  s.unread = 0;
  const fn = () => go("sessions", { cur: id, variant: null, chatHTML: null, banner: null });
  if (!document.startViewTransition || F.reduce) return fn();
  const vt = document.startViewTransition(fn);
  [vt.ready, vt.finished, vt.updateCallbackDone].forEach((pr) => pr.catch(() => {}));
}

/* ---------- palette (commands, settings, sessions, tools) ---------- */
const pal = (function () {
  const el = F.h(
    `<div class="pal-scrim" hidden><div class="pal" role="dialog"><input class="pal-input" placeholder="Search sessions, commands, settings, files…"><div class="pal-list"></div><div class="pal-foot"><span><kbd>↑↓</kbd> move</span><span><kbd>⏎</kbd> run</span><span><kbd>></kbd> commands only</span><span><kbd>@</kbd> settings only</span></div></div></div>`,
  );
  document.body.appendChild(el);
  const input = el.querySelector("input"),
    list = el.querySelector(".pal-list");
  const cmds = [
    ["New session", "⌘N", () => O["new-session"]()],
    ["New chat (no project)", "", () => go("sessions", { scope: "chats" })],
    ["Add a host", "⌃H", () => O["add-host"]()],
    ["Pair a device", "", () => O["pair-device"]()],
    [
      "Toggle changes drawer",
      "\\",
      () => {
        S.drawer = !S.drawer;
        render();
      },
    ],
    ["Switch permission mode: Plan", "⇧Tab", () => {}],
    ["Model: Sonnet 5", "", () => {}],
    ["Fast mode: On", "", () => {}],
    ["Import conversations", "", () => O.import()],
    ["Show keyboard shortcuts", "?", () => O.shortcuts()],
    ["Sentry: open issue…", "", () => go("sentry")],
    ["Restart daemon on devbox", "", () => U.toast("Restarting devbox daemon", { k: "running" })],
  ];
  let items = [],
    sel = 0;
  function paint() {
    const q = input.value.toLowerCase().replace(/^[>@]/, "");
    const only = input.value[0];
    const ss = only ? [] : F.sessions.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 4);
    const cs = only === "@" ? [] : cmds.filter((c) => c[0].toLowerCase().includes(q)).slice(0, 5);
    const st =
      only === ">"
        ? []
        : Settings.flat
            .filter(
              (x) =>
                (x.t + " " + x.g).toLowerCase().includes(q) ||
                (q.length > 2 && SETKW[x.id] && SETKW[x.id].includes(q)),
            )
            .slice(0, 5);
    const tl = only
      ? []
      : Tools.list.filter((t) => t.id && t.label.toLowerCase().includes(q) && q).slice(0, 3);
    items = [
      ...ss.map((s) => ({ s })),
      ...cs.map((c) => ({ c })),
      ...st.map((x) => ({ x })),
      ...tl.map((t) => ({ t })),
    ];
    sel = Math.min(sel, Math.max(0, items.length - 1));
    let i = 0;
    const it = (inner, meta = "") =>
      `<div class="pal-item ${i === sel ? "sel" : ""}" data-i="${i++}">${inner}${meta}</div>`;
    list.innerHTML =
      (ss.length
        ? '<div class="pal-group">Sessions</div>' +
          ss
            .map((s) =>
              it(
                `${R3.glyph(s.status)}<span class="pal-t">${esc(s.title)}</span>`,
                `<span class="pal-m">${F.projects.find((p) => p.id === s.project).name}</span>`,
              ),
            )
            .join("")
        : "") +
        (cs.length
          ? '<div class="pal-group">Commands</div>' +
            cs
              .map((c) =>
                it(
                  `<span class="pal-cmd">›</span><span class="pal-t">${c[0]}</span>`,
                  c[1] ? `<kbd class="pal-m">${c[1]}</kbd>` : "",
                ),
              )
              .join("")
          : "") +
        (st.length
          ? '<div class="pal-group">Settings</div>' +
            st
              .map((x) =>
                it(
                  `${ic("settings", 13)}<span class="pal-t">${x.t}${SETKW[x.id] && q.length > 2 && SETKW[x.id].includes(q) ? ` <small>› ${SETKW[x.id].split(",").find((k) => k.includes(q))}</small>` : ""}</span>`,
                  `<span class="pal-m">${x.g}${x.where ? " · " + x.where : ""}</span>`,
                ),
              )
              .join("")
          : "") +
        (tl.length
          ? '<div class="pal-group">Tools</div>' +
            tl
              .map((t) =>
                it(
                  `${t.ic ? ic(t.ic, 13) : ""}<span class="pal-t">${t.label}</span>`,
                  t.k ? `<kbd class="pal-m">${t.k}</kbd>` : "",
                ),
              )
              .join("")
          : "") || '<div class="none">No matches. Try > for commands or @ for settings.</div>';
  }
  function open(q = "") {
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("open"));
    input.value = q;
    sel = 0;
    paint();
    input.focus();
  }
  function close() {
    el.classList.remove("open");
    el.hidden = true;
  }
  function pick(i) {
    const it = items[i];
    close();
    if (!it) return;
    if (it.s) select(it.s.id);
    if (it.c) it.c[2]();
    if (it.x) go("settings", { page: it.x.id });
    if (it.t) go(it.t.id);
  }
  input.addEventListener("input", () => {
    sel = 0;
    paint();
  });
  list.addEventListener("click", (e) => {
    const x = e.target.closest(".pal-item");
    if (x) pick(+x.dataset.i);
  });
  el.addEventListener("mousedown", (e) => {
    if (e.target === el) close();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      sel = Math.min(items.length - 1, sel + 1);
      paint();
      e.preventDefault();
    }
    if (e.key === "ArrowUp") {
      sel = Math.max(0, sel - 1);
      paint();
      e.preventDefault();
    }
    if (e.key === "Enter") pick(sel);
    if (e.key === "Escape") close();
  });
  return { open, close };
})();
const SETKW = {
  appearance: "theme,font,syntax,reduce motion,dark,light,session list,rail",
  chat: "send,steer,queue,interrupt,tool calls,reasoning,outline,downloads,service url",
  editor: "vim,terminal,scrollback,editor,side pane,browser data",
  notify: "notifications,sound,push,quiet hours,inbox,spoken",
  voice: "companion,voice,dictation,speech",
  providers: "provider,model,install,codex,claude,copilot,opencode",
  accounts: "account,sign in,login,default account",
  modes: "permission,bypass,full access,allow all,plan mode,auto-edit,unattended",
  usage: "usage,quota,limit,meter,threshold,refresh",
  context: "clean cut,cache,idle,summary,compact",
  orchestration: "mcp,skills,system prompt,browser tools,hooks,agent definitions",
  host: "rename host,relay,connections,web client",
  devices: "pair,device,role,owner,operator,viewer,revoke",
  security: "password,claim,trust lan,listen,bind",
  automation: "archive merged,metadata,branch names",
  labels: "labels,tags",
  terminals: "terminal profiles,shell",
  resources: "storage,disk,cpu,memory,clean",
  daemon: "daemon,update,restart,logs,version",
  worktrees: "worktree,setup,teardown,base branch,ports",
  scripts: "scripts,services,port,dev server",
  ci: "ci,jenkins,github actions,release streams",
  metadata: "commit message,pr description,branch name",
  updates: "update,release channel,beta,version",
  developer: "developer,dev build,beta daemon",
};

/* ---------- events ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (!t.closest(".menu") && !t.closest("[data-act]")) U.closeMenus();
  if (t.closest("[data-close]") || t.classList.contains("scrim")) return U.close();
  const mi = t.closest(".menu .mi");
  if (mi && !mi.dataset.act) {
    U.closeMenus();
  }
  const act = t.closest("[data-act]");
  if (act) {
    const a = act.dataset.act;
    e.stopPropagation();
    if (a.startsWith("scope:")) {
      U.close();
      return go("sessions", { scope: a.slice(6), mview: "list" });
    }
    if (a.startsWith("tool:")) {
      U.close();
      return go(a.slice(5));
    }
    if (a.startsWith("page:")) {
      U.close();
      return go("settings", { page: a.slice(5) });
    }
    if (a === "drawer") {
      S.drawer = !S.drawer;
      return document.body.classList.toggle("drawer", S.drawer);
    }
    if (a === "approve" || a === "deny") return resolvePerm(a);
    if (a === "m-more") return mMore();
    if (O[a]) return O[a](act);
  }
  const qa = t.closest("[data-qa]");
  if (qa) {
    e.stopPropagation();
    return approve(qa.dataset.qa);
  }
  const tool = t.closest("[data-tool]");
  if (tool) {
    U.close();
    return go(tool.dataset.tool, {
      mview: matchMedia("(max-width:720px)").matches ? "list" : "main",
    });
  }
  const st = t.closest("[data-settings]");
  if (st) return go("settings", { page: st.dataset.settings });
  const pg = t.closest("[data-page]");
  if (pg) {
    U.close();
    return go("settings", { page: pg.dataset.page });
  }
  const x = t.closest(".tab .x");
  if (x && x.parentElement.dataset.id) {
    e.stopPropagation();
    S.open = S.open.filter((i) => i !== x.parentElement.dataset.id);
    return select(S.open[0] || "s1");
  }
  const id = t.closest("[data-id]");
  if (id) return select(id.dataset.id);
  for (const [k, prop] of [
    ["prtab", "prTab"],
    ["tasktab", "taskTab"],
    ["plugtab", "plugTab"],
  ]) {
    const b = t.closest(`[data-${k}]`);
    if (b) return go(S.tool, { [prop]: b.dataset[k] });
  }
  const h = t.closest("[data-host]");
  if (h) return go("hosts", { host: h.dataset.host });
  if (t.closest("[data-back]")) {
    document.body.dataset.mview = "list";
    return;
  }
  if (t.closest("[data-pal]")) return pal.open();
  const tg = t.closest(".tg");
  if (tg && !tg.classList.contains("dis")) tg.classList.toggle("on");
  const sg = t.closest(".segc button");
  if (sg) {
    sg.parentElement.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b === sg));
  }
  const chip = t.closest(".tchip");
  if (chip) chip.classList.toggle("on");
  const sideRow = t.closest(
    "#side .list .row, #side .list .tn, #side .list .file, #side .list .hit, #main .bcard, #main .job",
  );
  if (sideRow) {
    sideRow.parentElement.querySelectorAll(".on").forEach((r) => r.classList.remove("on"));
    sideRow.classList.add("on");
    reglide();
  }
  const tl = t.closest(".tool-head");
  if (tl) tl.parentElement.classList.toggle("open");
});
document.addEventListener("contextmenu", (e) => {
  const r = e.target.closest("[data-rowmenu],[data-filemenu],[data-tabmenu]");
  if (!r) return;
  e.preventDefault();
  const a = { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY };
  if (r.dataset.rowmenu != null) O["row-menu"](a);
  else if (r.dataset.filemenu != null) O["file-menu"](a);
  else O["tab-menu"](a);
});
function approve(id) {
  const s = F.sessions.find((x) => x.id === id);
  s.status = "running";
  U.toast(`Approved · ${s.title}`, { d: "pnpm db:migrate --env staging", act: "Undo" });
  render();
}
function resolvePerm(a) {
  const p = $("#perm");
  if (!p) return;
  p.classList.add("resolved");
  p.querySelector(".perm-actions").outerHTML =
    `<div class="perm-result">${a === "approve" ? "Approved" : "Denied"} by you · just now</div>`;
  const s = F.sessions.find((x) => x.id === S.cur);
  if (s.status === "permission") {
    s.status = a === "approve" ? "running" : "idle";
    $("#side").innerHTML = Tools.get(S.tool).side(S);
    $("#rail").innerHTML = rail();
    reglide();
  }
}
function mMore() {
  U.modal({
    kind: "sheet",
    eyebrow: "Tools",
    title: "All tools",
    body: `<div class="mgrid">${Tools.list
      .filter((t) => t.id && !MKEEP.includes(t.id))
      .map(
        (t) =>
          `<button class="mt" data-tool="${t.id}" ${t.act ? `data-act="${t.act}"` : ""}>${t.plugin ? R3.facet(t.plugin[0], t.plugin[1], 22) : ic(t.ic, 22)}<span>${t.label}</span>${t.badge && t.badge() ? `<i>${t.badge()}</i>` : ""}</button>`,
      )
      .join("")}</div>`,
  });
}
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return pal.open();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === ",") {
    e.preventDefault();
    return go("settings");
  }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
    e.preventDefault();
    return O["new-session"]();
  }
  if (e.target.isContentEditable || /INPUT|TEXTAREA/.test(e.target.tagName)) {
    if (e.target.classList.contains("composer-input") && e.key === "/" && !e.target.textContent)
      setTimeout(() => O.slash(), 0);
    return;
  }
  if (e.key === "Escape") return U.close();
  if (S.tool === "sessions" && (e.key === "j" || e.key === "k")) {
    const ids = [...document.querySelectorAll("#side .row[data-id]")].map((r) => r.dataset.id);
    const i = ids.indexOf(S.cur);
    const n = ids[e.key === "j" ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1)];
    if (n) select(n);
  }
  if (e.key === "a" || e.key === "A") {
    const s = F.sessions.find((x) => x.id === S.cur);
    if ($("#perm")) resolvePerm("approve");
    else if (s.status === "permission") approve(s.id);
  }
  if (e.key === "\\") {
    S.drawer = !S.drawer;
    document.body.classList.toggle("drawer", S.drawer);
  }
  if (e.key === "?") O.shortcuts();
});
addEventListener("resize", reglide);
R3.spotlight(document.body);
