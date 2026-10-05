/* Session main area: tabs, header, transcript variants, composer. */
window.Chat = (function () {
  const F = Frogg,
    { ic, esc } = U;
  const proj = (s) => F.projects.find((p) => p.id === s.project);
  const who = (a) => `<div class="who"><span class="agent-swatch"></span>${F.agents[a].name}</div>`;
  const tool = (verb, target, meta, k = "done", body = "", ico = "run") =>
    `<div class="tool ${k} ${body ? "open" : ""}"><div class="tool-head"><span class="tool-ico">${F.icons[ico]}</span><span class="verb">${verb}</span><span class="target">${target}</span><span class="tool-meta">${meta}</span><span class="tool-state"></span></div>${body}${k === "running" ? '<div class="tool-beam"></div>' : ""}</div>`;
  const diff = () =>
    `<div class="tool-body diff">${[
      ["ctx", "  export function createSessionStore(db: Db) {"],
      ["del", "-   const cache = new Map<string, Session>();"],
      ["add", "+   const cache = new LRU<string, Session>({ max: 500 });"],
      ["add", "+   const writes = new WriteQueue(db, { flushMs: 50 });"],
      ["ctx", "    return {"],
      ["del", "-     save: (s) => db.put(s.id, s),"],
      ["add", "+     save: (s) => { cache.set(s.id, s); writes.enqueue(s); },"],
    ]
      .map(([k, l], i) => `<div class="dl ${k}" style="--i:${i}">${esc(l)}</div>`)
      .join("")}</div>`;
  const planCard = () =>
    `<div class="todo-card"><div class="tc-h">${ic("tasks", 14)}<b>Plan</b><span>3 / 6 tasks</span><span class="meter-s"><i style="width:50%"></i></span><button class="link" data-tool="tasks">Open in Tasks</button></div>${D.plan
      .map(([t, k]) => `<div class="tc-r st-${k}">${R3.glyph(k)}<span>${t}</span></div>`)
      .join("")}</div>`;
  const subCard = () =>
    `<div class="sub-card"><div class="tc-h">${ic("sessions", 14)}<b>Subagents</b><span>1 working · 1 needs you · 1 done</span></div>${D.subagents
      .map(
        ([t, k, m, type]) =>
          `<button class="tc-r st-${k}">${R3.glyph(k)}<span>${t}</span><i>${type}</i><em>${m}</em></button>`,
      )
      .join("")}</div>`;
  const permCard = (cmd, extra = "") =>
    `<div class="perm" id="perm"><div class="perm-head">${F.icons.lock}<span>Permission needed</span><span class="perm-agent">Bash · Auto-edit asks before commands</span></div><div class="perm-body">Run <code>${cmd}</code>${extra}</div><div class="perm-actions"><button class="btn deny" data-act="deny">Deny <kbd>Esc</kbd></button><button class="btn ghost">Allow for this session</button><button class="btn ghost">Reply instead…</button><button class="btn approve" data-act="approve">Approve <kbd>A</kbd></button></div></div>`;

  function transcript(s, v) {
    const a = s.agent,
      p = proj(s);
    const head = `<div class="turn-divider"><span>${p.name} · ${s.branch} · worktree</span></div>`;
    if (s.id === "s1" || v === "s1") {
      return `${head}
      <div class="msg user"><div class="bubble">The daemon’s RSS keeps climbing on long-lived hosts. Look at the session store, bound the cache, and batch the writes. Keep the public API stable.</div></div>
      <div class="msg agent">${who("claude")}<details class="reasoning"><summary>Thought for 6 steps</summary></details><div class="md"><p>Reading the store, its callers and the persistence tests first, and sending an Explore subagent to map every caller.</p></div></div>
      ${tool("Read", "6 files", "session-store.ts, db.ts, drafts.ts, …", "done", "", "read")}
      ${subCard()}
      ${tool("Edit", "packages/server/src/session-store.ts", '<span class="add">+4</span> <span class="del">−2</span>', "done", diff(), "edit")}
      <div class="msg agent"><div class="md"><p>The cache was an unbounded <code>Map</code>, so long-lived daemons kept every session ever opened in memory. I swapped it for an LRU capped at 500 and routed writes through a queue that coalesces bursts: the composer saves on every keystroke while a draft is open, which was the real source of the write amplification.</p></div></div>
      ${planCard()}
      ${tool("Run", "pnpm --filter server test", "142 passed · 3.1s", "done")}
      ${tool("Run", "node scripts/bench-drafts.js --runs 5", "run 3/5", "running")}
      <div class="thinking"><span class="shimmer">Benchmarking draft saves</span><span class="elapsed">0:41</span></div>`;
    }
    if (v === "plan")
      return `${head}<div class="msg user"><div class="bubble">Render invoices to PDF server-side. Match the HTML preview exactly, and keep it under 300 ms for a 3-page invoice.</div></div>
      <div class="msg agent">${who(a)}<div class="md"><p>I’ve read the invoice templates and the current HTML preview. Here is the plan; nothing changes until you approve it.</p></div></div>
      <div class="plan-review"><div class="perm-head">${ic("tasks", 14)}<span>Plan ready for review</span><span class="perm-agent">Plan mode · Claude Code</span></div>
      <ol>${["Add <code>@frogg/pdf</code> wrapper around headless Chromium with a warm page pool (2 pages).", "Reuse <code>InvoiceView</code> with a print stylesheet; no second template.", "New route <code>GET /invoices/:id.pdf</code>, cached by invoice hash for 24 h.", "Golden tests: render 3 fixtures, diff against stored PDFs page by page.", "Benchmark: p95 under 300 ms for a 3-page invoice on devbox.", "Docs: billing-api README section “PDF rendering”."].map((t) => `<li>${t}</li>`).join("")}</ol>
      <div class="pr-meta">Touches 7 files · new dependency <code>puppeteer-core</code> · est. +420 lines</div>
      <div class="perm-actions"><button class="btn deny">Reject</button><button class="btn ghost">Edit plan…</button><button class="btn ghost">Implement in Ask mode</button><button class="btn approve">Implement <kbd>A</kbd></button></div></div>`;
    if (v === "question")
      return `${head}<div class="msg user"><div class="bubble">Add retries to the Stripe webhook handler.</div></div>
      <div class="msg agent">${who(a)}<div class="md"><p>Before I change the handler, one decision affects the schema.</p></div></div>
      <div class="question"><div class="perm-head">${ic("chat", 14)}<span>Question 1 of 2</span><span class="perm-agent">Codex</span></div>
      <p class="q">Where should failed webhook attempts be persisted between retries?</p>
      ${[
        [
          "Postgres table <code>webhook_attempts</code>",
          "Durable, queryable, needs a migration",
          true,
        ],
        ["Redis list with TTL", "No migration, lost on flush"],
        ["In-memory only", "Simplest, lost on restart"],
      ]
        .map(
          ([t, d, on]) =>
            `<button class="qopt ${on ? "on" : ""}"><span class="radio"></span><span><b>${t}</b><small>${d}</small></span></button>`,
        )
        .join("")}
      <button class="qopt other"><span class="radio"></span><span><b>Other…</b></span></button>
      <div class="perm-actions"><span class="sp"></span><button class="btn approve">Next <kbd>⏎</kbd></button></div></div>`;
    if (v === "cleancut")
      return `${head}<div class="msg user"><div class="bubble">Rewrite the pairing guide around the single pairing flow.</div></div>${tool("Read", "docs/pairing/*.mdx", "9 files", "done", "", "read")}
      <div class="cut"><span>Clean cut</span><p>Summarised 182k tokens into 3.1k with Haiku 5 · $0.04 · cache had expired (idle 1h 20m)</p><button class="link">Copy previous conversation ID</button></div>
      <div class="msg agent">${who(a)}<div class="md"><p>Picking up from the summary: sections 1–3 are rewritten, 4 (Claim) folds into the confirm step. Continuing with “Pair a device”.</p></div></div>`;
    if (v === "offline")
      return `${head}<div class="state-card err">${R3.glyph("error")}<div><b>ci-runner-2 is unreachable</b><p>SSH tunnel failed: connection refused on port 22. Showing the last saved activity (12m ago).</p><div class="acts">${U.btn("Retry now", "approve")}${U.btn("Manage host", "ghost", 'data-tool="hosts"')}</div></div></div>${tool("Run", "terraform plan -out tf.plan", "host unreachable", "fail", "", "run")}`;
    return F.mountChat ? staticFor(s) : "";
  }
  function staticFor(s) {
    const box = document.createElement("div");
    F.mountChat(box, s, { scroller: box });
    let html = box.innerHTML;
    if (s.status === "permission")
      html = html.replace(
        /<div class="perm" data-static[^>]*>[\s\S]*$/,
        permCard(
          "pnpm db:migrate --env staging",
          '<div class="perm-ctx">Applies 2 migrations to <b>staging</b>: <code>0042_draft_versions</code>, <code>0043_draft_index</code></div>',
        ),
      );
    return html;
  }

  function composer(s, o = {}) {
    const mode = o.mode || "Auto-edit";
    return `<div class="composer" data-state="${o.state || "idle"}">
      ${o.notice || ""}
      <div class="att-row">${o.att || ""}</div>
      <div class="composer-input" contenteditable="true" data-placeholder="Message ${F.agents[s.agent].name} — @ files, / commands, ⏎ steer, ⌘⏎ queue">${o.text || ""}</div>
      <div class="composer-bar">
        <button class="icon-btn" data-act="attach" title="Attach">${ic("plus", 16)}</button>
        <button class="chip chip-agent" data-act="provider"><span class="agent-swatch"></span>${F.agents[s.agent].name}</button>
        <button class="chip chip-model" data-act="model">Opus 5.5 <span class="sub">· high</span></button>
        <button class="chip chip-mode" data-act="mode">${ic("shield", 11)} ${mode}</button>
        <button class="chip chip-account" data-act="account">steve@work</button>
        <span class="bar-spacer"></span>
        <span class="ctxm" title="Context window">${F.ring(23, "ctx", 18)}<span>46k / 200k · $0.82</span></span>
        <button class="icon-btn mic" title="Dictation ⌘D">${F.icons.mic}</button>
        <button class="send" title="Send">${s.status === "running" ? F.icons.stop : F.icons.send}</button>
      </div></div>`;
  }
  function header(s) {
    const p = proj(s);
    return `<div class="sh">
      <div class="sh-t"><div class="crumb">${R3.projFacet(p.id, 12)}<span>${p.host}</span><i>/</i><span>${p.name}</span><i>/</i><b>${s.branch}</b></div>
      <h1><button class="m-back" data-back>←</button>${esc(s.title)}</h1>
      <div class="meta">${R3.glyph(s.status)}<span>${F.statusLabel[s.status]}</span><span>${F.agents[s.agent].name}</span><span>Opus 5.5</span>${s.id === "s1" ? '<span class="lbl" style="--c:#38bdf8">daemon</span><span><a class="link" data-tool="prs">PR #1284 · draft</a></span><span>checks ' + R3.glyph("running") + " 3/5</span>" : ""}</div></div>
      <div class="acts">
        <button class="btn ghost" data-act="drawer">Changes <b>${s.add ? `+${s.add} −${s.del}` : ""}</b></button>
        <button class="btn ghost" data-tool="terminals">Terminal</button>
        <button class="btn ${s.status === "done" ? "approve" : ""}" data-tool="prs">${s.id === "s1" ? "View PR" : "Create PR"}</button>
        <button class="btn ghost icon" data-act="session-menu" aria-label="Session actions">${ic("more", 16)}</button>
      </div></div>`;
  }
  function tabs(S) {
    return `<div class="tabs">${S.open
      .map((id) => {
        const s = F.sessions.find((x) => x.id === id);
        return `<button class="tab ${id === S.cur ? "on" : ""}" data-id="${id}" data-tabmenu>${R3.glyph(s.status)}<span>${esc(s.title)}</span><span class="x">×</span></button>`;
      })
      .join(
        "",
      )}<button class="tab add" data-act="new-tab" aria-label="New tab">${ic("plus", 14)}</button><span class="tab-fill"></span></div>`;
  }
  function main(S) {
    const s = F.sessions.find((x) => x.id === S.cur);
    const st =
      s.status === "permission"
        ? "permission-static"
        : s.status === "running"
          ? "streaming"
          : "idle";
    return `${tabs(S)}${S.banner || ""}${header(s)}
      <div class="body ${S.drawer ? "drawer-open" : ""}">
        <div class="chatcol"><div class="scroll" id="scroll"><div class="chat">${S.chatHTML || transcript(s, S.variant)}</div></div>
        <div class="dock"><div>${s.add ? F.diffStripHTML(s) : ""}${composer(s, { state: st, ...(S.comp || {}) })}</div></div></div>
        <aside class="drawer"><div class="dr-h"><span class="eyebrow">Changes · ${s.branch}</span><button class="link" data-act="drawer">Close <kbd>\\</kbd></button></div>${R3.changes(s)}</aside>
      </div>`;
  }
  return { main, transcript, composer, permCard, tool };
})();
