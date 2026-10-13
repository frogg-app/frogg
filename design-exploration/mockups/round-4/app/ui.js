/* Round-4 UI primitives: icons, form controls, overlay layer (modal, sheet, menu, toast). */
window.U = (function () {
  const P = {
    sessions: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 12l9 4 9-4M3 17l9 4 9-4"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    files: '<path d="M5 3h9l5 5v13H5z"/><path d="M14 3v5h5"/>',
    scm: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-12 3-12 8"/>',
    pr: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17V10a3 3 0 0 0-3-3h-4M13 5l-2 2 2 2"/>',
    terminal: '<path d="M3 5h18v14H3z"/><path d="M7 9l3 3-3 3M12 15h5"/>',
    tasks:
      '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M3.5 6l1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11"/><path d="M4 18h3"/>',
    hosts: '<path d="M3 4h18v7H3zM3 13h18v7H3z"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    usage: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-6"/>',
    plugins:
      '<path d="M10 3h4v4h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4H4a2 2 0 1 1 0-4h2V7h4z"/>',
    inbox: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
    voice:
      '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/>',
    branch:
      '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-12 3-12 8"/>',
    link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
    attach: '<path d="M20 11l-8 8a5 5 0 0 1-7-7l8-8a3.5 3.5 0 0 1 5 5l-8 8a2 2 0 0 1-3-3l7-7"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2 6M20 5v6h-6"/>',
    filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
    lock: '<rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
    split: '<path d="M3 4h18v16H3zM12 4v16"/>',
    globe:
      '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    play: '<path d="M7 5l12 7-12 7z"/>',
    stop: '<path d="M6 6h12v12H6z"/>',
    copy: '<path d="M8 8h12v12H8z"/><path d="M4 16V4h12"/>',
    archive: '<path d="M3 4h18v4H3zM5 8v12h14V8M10 12h4"/>',
    pin: '<path d="M9 3h6l-1 6 4 4H6l4-4zM12 13v8"/>',
    tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><path d="M7.5 7.5h.01"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
    edit: '<path d="M4 20h4L20 8l-4-4L4 16z"/>',
    image: '<path d="M3 5h18v14H3z"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 8"/>',
    issue: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    upload: '<path d="M12 16V4M6 10l6-6 6 6M4 20h16"/>',
    qr: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM18 18h3v3h-3zM18 14h3M14 18v3"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="1"/><path d="M11 18h2"/>',
    laptop: '<path d="M5 5h14v10H5zM2 19h20"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/>',
    cpu: '<path d="M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/>',
    wave: '<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
    book: '<path d="M4 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4zM20 4h-5a3 3 0 0 0-3 3"/>',
    chat: '<path d="M4 4h16v12H9l-5 4z"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>',
  };
  const ic = (k, s = 16, w = 1.7) =>
    `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k] || ""}</svg>`;
  const esc = (s) => Frogg.esc(s);
  // controls
  const tg = (on, dis) =>
    `<button class="tg ${on ? "on" : ""} ${dis ? "dis" : ""}" role="switch" aria-checked="${!!on}"><i></i></button>`;
  const sel = (v, wide) =>
    `<button class="sel ${wide ? "wide" : ""}"><span>${v}</span>${ic("down", 12)}</button>`;
  const seg = (opts, i, cls = "") =>
    `<span class="segc ${cls}">${opts.map((o, j) => `<button class="${j === i ? "on" : ""}">${o}</button>`).join("")}</span>`;
  const inp = (v, ph = "", cls = "") =>
    `<span class="inp ${cls}"><input value="${esc(v)}" placeholder="${esc(ph)}" spellcheck="false"></span>`;
  const area = (v, ph = "", rows = 3) =>
    `<textarea class="area" rows="${rows}" placeholder="${esc(ph)}" spellcheck="false">${esc(v)}</textarea>`;
  const num = (v, unit) =>
    `<span class="inp num"><input value="${v}">${unit ? `<i>${unit}</i>` : ""}</span>`;
  const btn = (t, k = "", attrs = "") => `<button class="btn ${k}" ${attrs}>${t}</button>`;
  const badge = (t, k = "") => `<span class="bdg ${k}">${t}</span>`;
  const scope = (k) =>
    ({
      device: badge("This device", "sc-dev"),
      host: badge("devbox · config.json", "sc-host"),
      project: badge("frogg-app · frogg.json", "sc-proj"),
      new: badge("new", "new"),
    })[k] || "";
  const row = (label, desc, ctl, o = {}) =>
    `<div class="srow ${o.cls || ""}" ${o.id ? `id="${o.id}"` : ""}><div class="sl"><b>${label}${o.tag ? " " + o.tag : ""}</b>${desc ? `<p>${desc}</p>` : ""}</div><div class="sc">${ctl}</div></div>`;
  const sec = (t, body, note) =>
    `<section class="ssec"><h3>${t}</h3>${note ? `<p class="snote">${note}</p>` : ""}<div class="sbox">${body}</div></section>`;
  const meter = (pct, cls = "") =>
    `<span class="meter ${cls} ${pct >= 90 ? "crit" : pct >= 65 ? "warn" : ""}"><i style="width:${pct}%"></i></span>`;
  const glyph = (k) =>
    R3.glyph(
      k === "ci" ? "error" : k === "plugin" || k === "system" || k === "device" ? "idle" : k,
    );

  // overlay layer
  const layer = () => document.getElementById("layer");
  function modal(o) {
    close();
    const el = document.createElement("div");
    el.className = `scrim ${o.kind || "modal"}`;
    el.innerHTML = `<div class="dlg ${o.size || ""} ${o.danger ? "danger" : ""}" role="dialog" aria-label="${esc(o.title)}">
      <header class="dlg-h">${o.eyebrow ? `<span class="eyebrow">${o.eyebrow}</span>` : ""}<h2>${o.title}</h2>${o.sub ? `<p>${o.sub}</p>` : ""}<button class="x" data-close aria-label="Close">${ic("close", 14)}</button></header>
      <div class="dlg-b">${o.body}</div>${o.foot ? `<footer class="dlg-f">${o.foot}</footer>` : ""}</div>`;
    layer().appendChild(el);
    requestAnimationFrame(() => el.classList.add("open"));
    return el;
  }
  function menu(anchor, items, o = {}) {
    closeMenus();
    const el = document.createElement("div");
    el.className = `menu ${o.cls || ""}`;
    el.innerHTML =
      (o.head || "") +
      items
        .map((it) =>
          it === "-"
            ? "<hr>"
            : typeof it === "string"
              ? `<div class="mh">${it}</div>`
              : `<button class="mi ${it.on ? "on" : ""} ${it.danger ? "danger" : ""} ${it.dis ? "dis" : ""}" ${it.act ? `data-act="${it.act}"` : ""}>${it.ic ? ic(it.ic, 14) : it.glyph || '<span class="mi-sp"></span>'}<span class="mi-t">${it.t}${it.d ? `<small>${it.d}</small>` : ""}</span>${it.k ? `<kbd>${it.k}</kbd>` : ""}${it.on ? `<span class="mi-ok">${ic("check", 13)}</span>` : ""}${it.sub ? `<span class="mi-sub">${ic("chev", 12)}</span>` : ""}</button>`,
        )
        .join("");
    layer().appendChild(el);
    const r =
      typeof anchor === "object" && anchor.getBoundingClientRect
        ? anchor.getBoundingClientRect()
        : anchor;
    const w = el.offsetWidth,
      hgt = el.offsetHeight;
    let x = o.right ? r.right - w : r.left,
      y = o.up ? r.top - hgt - 6 : r.bottom + 6;
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    y = Math.max(8, Math.min(innerHeight - hgt - 8, y));
    el.style.left = x + "px";
    el.style.top = y + "px";
    requestAnimationFrame(() => el.classList.add("open"));
    return el;
  }
  function pop(anchor, html, o = {}) {
    const el = menu(anchor, [], { ...o, head: html, cls: "pop " + (o.cls || "") });
    return el;
  }
  function toast(t, o = {}) {
    let box = document.querySelector(".toasts");
    if (!box) {
      box = document.createElement("div");
      box.className = "toasts";
      layer().appendChild(box);
    }
    const el = document.createElement("div");
    el.className = `toast ${o.k || ""}`;
    el.innerHTML = `${o.k ? R3.glyph(o.k) : ic("check", 14)}<div class="tt"><b>${t}</b>${o.d ? `<span>${o.d}</span>` : ""}</div>${o.act ? `<button class="link">${o.act}</button>` : ""}<button class="x" aria-label="Dismiss">${ic("close", 12)}</button>`;
    box.appendChild(el);
    if (!o.sticky) setTimeout(() => el.classList.add("out"), 4200);
    if (!o.sticky) setTimeout(() => el.remove(), 4700);
    return el;
  }
  const closeMenus = () => document.querySelectorAll("#layer .menu").forEach((m) => m.remove());
  function close() {
    closeMenus();
    document.querySelectorAll("#layer .scrim").forEach((m) => m.remove());
  }
  return {
    ic,
    tg,
    sel,
    seg,
    inp,
    area,
    num,
    btn,
    badge,
    scope,
    row,
    sec,
    meter,
    glyph,
    modal,
    menu,
    pop,
    toast,
    close,
    closeMenus,
    esc,
  };
})();
