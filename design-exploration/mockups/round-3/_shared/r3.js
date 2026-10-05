/* Round-3 helpers: deterministic facet glyphs (portfolio shard language), cursor
   spotlight, a persistent selection indicator that glides between rows, and the
   right-hand changes pane. */
window.R3 = (function () {
  const F = window.Frogg;
  const hues = {
    frogg: ["#7fd9e6", "#045b9d"],
    billing: ["#3fcf8e", "#25b5c8"],
    docs: ["#8b7cf6", "#25b5c8"],
    infra: ["#f5b84a", "#e0605a"],
  };
  let uid = 0;
  function facet(seed, hue, size = 20) {
    let h = 2166136261;
    for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0) % 1000) / 1000;
    const n = 6;
    const ring = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
      const r = 36 + rnd() * 12;
      return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r];
    });
    const core = [42 + rnd() * 16, 42 + rnd() * 16];
    const id = "fg" + seed.replace(/\W/g, "") + ++uid;
    return `<svg class="facet" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hue[0]}"/><stop offset="1" stop-color="${hue[1]}"/></linearGradient></defs>${ring
      .map((p, i) => {
        const q = ring[(i + 1) % n];
        return `<polygon style="--i:${i};opacity:${0.5 + ((i * 37) % 50) / 100}" fill="url(#${id})" points="${core.join(",")} ${p.join(",")} ${q.join(",")}"/>`;
      })
      .join("")}</svg>`;
  }
  const projFacet = (pid, size) => facet(pid, hues[pid], size);
  // Status as shape + word, never colour alone.
  const glyph = (st) => `<span class="sg sg-${st}" title="${F.statusLabel[st]}"></span>`;

  function spotlight(root) {
    root.addEventListener("pointermove", (e) => {
      const el = e.target.closest("[data-spot]");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  }
  // Glide a persistent indicator to the active element inside `box`.
  function glide(box, ind, sel = ".on") {
    const t = box.querySelector(sel);
    if (!t) {
      ind.style.opacity = 0;
      return;
    }
    const b = box.getBoundingClientRect(),
      r = t.getBoundingClientRect();
    ind.style.opacity = 1;
    ind.style.transform = `translate(${r.left - b.left + box.scrollLeft}px, ${r.top - b.top + box.scrollTop}px)`;
    ind.style.width = r.width + "px";
    ind.style.height = r.height + "px";
  }
  const FILES = [
    ["packages/server/src", "session-store.ts", 112, 41, "M"],
    ["packages/server/src", "write-queue.ts", 64, 0, "A"],
    ["packages/server/src/util", "lru.ts", 31, 0, "A"],
    ["packages/server/test", "session-store.test.ts", 7, 46, "M"],
  ];
  function changes(cur) {
    if (!cur.add) return `<div class="empty">No changes in this worktree yet.</div>`;
    const max = Math.max(...FILES.map((f) => f[2] + f[3]));
    return `<div class="files">${FILES.map(
      (
        [dir, f, a, d, k],
        i,
      ) => `<button class="file ${i === 0 ? "on" : ""}" data-spot style="--i:${i}">
        <span class="fk fk-${k}">${k}</span><span class="fn"><b>${f}</b><i>${dir}</i></span>
        <span class="fbar"><span class="fa" style="width:${(a / max) * 100}%"></span><span class="fd" style="width:${(d / max) * 100}%"></span></span>
        <span class="fs"><span class="add">+${a}</span> <span class="del">−${d}</span></span></button>`,
    ).join("")}</div>
    <div class="hunk"><div class="hunk-h">session-store.ts <span>@@ -12,8 +12,9 @@</span></div>
    ${[
      ["ctx", "export function createSessionStore(db: Db) {"],
      ["del", "  const cache = new Map<string, Session>();"],
      ["add", "  const cache = new LRU<string, Session>({ max: 500 });"],
      ["add", "  const writes = new WriteQueue(db, { flushMs: 50 });"],
      ["ctx", "  return {"],
      ["del", "    save: (s) => db.put(s.id, s),"],
      ["add", "    save: (s) => { cache.set(s.id, s); writes.enqueue(s); },"],
      ["add", "    flush: () => writes.drain(),"],
    ]
      .map(
        ([k, l], i) =>
          `<div class="hl ${k}"><span class="ln">${12 + i}</span><span class="sym">${k === "add" ? "+" : k === "del" ? "−" : " "}</span>${F.esc(l)}</div>`,
      )
      .join("")}</div>
    <div class="pane-actions"><button class="btn ghost">Discard</button><button class="btn">Stage all</button><button class="btn approve">Commit &amp; push</button></div>`;
  }
  const terminal = () =>
    `<pre class="term"><span class="pr">devbox ~/frogg-app (feat/session-store) $</span> pnpm --filter server test
 ✓ session-store.test.ts (38)
 ✓ write-queue.test.ts (21)
 ✓ lru.test.ts (12)
 … 71 more

 <b>Test Files</b>  14 passed (14)
 <b>Tests</b>      142 passed (142)
 <b>Duration</b>   3.1s
<span class="pr">devbox ~/frogg-app (feat/session-store) $</span> <span class="cursor"></span></pre>`;
  return { facet, projFacet, hues, glyph, spotlight, glide, changes, terminal };
})();
// Re-measure gliding indicators once webfonts settle (row heights shift).
document.fonts &&
  document.fonts.ready.then(() => setTimeout(() => dispatchEvent(new Event("resize")), 50));
