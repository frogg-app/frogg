/* Frogg round-1 mockups: shared fake data + behaviour. Each direction styles the
   semantic markup (.msg, .tool, .perm, .dstrip, .composer, .pal ...) its own way. */
(function () {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const T = { fast: 100, quick: 150, base: 200, moderate: 280, slow: 400 };

  const agents = {
    claude: { name: "Claude Code", short: "CC", hue: 28 },
    codex: { name: "Codex", short: "CX", hue: 200 },
    copilot: { name: "Copilot", short: "CP", hue: 280 },
    opencode: { name: "OpenCode", short: "OC", hue: 150 },
    pi: { name: "Oh My Pi", short: "π", hue: 330 },
  };

  const projects = [
    { id: "frogg", name: "frogg-app", host: "devbox" },
    { id: "billing", name: "billing-api", host: "devbox" },
    { id: "docs", name: "docs-site", host: "macbook" },
    { id: "infra", name: "infra", host: "ci-runner-2" },
  ];

  const S = (id, project, title, branch, status, agent, add, del, ago, extra) =>
    Object.assign(
      { id, project, title, branch, status, agent, add, del, ago, unread: 0 },
      extra || {},
    );
  const sessions = [
    S(
      "s1",
      "frogg",
      "Session store persistence refactor",
      "feat/session-store",
      "running",
      "claude",
      214,
      87,
      "now",
      { unread: 3 },
    ),
    S(
      "s2",
      "frogg",
      "Fix composer draft loss on reconnect",
      "fix/draft-loss",
      "permission",
      "codex",
      32,
      9,
      "1m",
    ),
    S(
      "s3",
      "frogg",
      "Plugin API v1 media hooks",
      "feat/plugin-media",
      "running",
      "opencode",
      498,
      120,
      "now",
    ),
    S(
      "s4",
      "frogg",
      "Android push for approvals",
      "feat/push-approvals",
      "idle",
      "claude",
      76,
      14,
      "18m",
    ),
    S(
      "s5",
      "frogg",
      "Translate settings strings (9 locales)",
      "chore/i18n-settings",
      "done",
      "copilot",
      912,
      40,
      "6m",
      { unread: 1 },
    ),
    S(
      "s6",
      "billing",
      "Stripe webhook retries",
      "fix/webhook-retry",
      "error",
      "codex",
      18,
      3,
      "4m",
    ),
    S(
      "s7",
      "billing",
      "Invoice PDF renderer",
      "feat/invoice-pdf",
      "permission",
      "claude",
      140,
      2,
      "2m",
    ),
    S("s8", "billing", "Migrate to pg 17", "chore/pg17", "idle", "pi", 0, 0, "3h"),
    S("s9", "docs", "Rewrite pairing guide", "docs/pairing", "running", "claude", 63, 71, "now"),
    S("s10", "docs", "Screenshot refresh", "docs/shots", "idle", "copilot", 0, 0, "1d"),
    S(
      "s11",
      "infra",
      "Runner disk cleanup cron",
      "ops/runner-gc",
      "done",
      "opencode",
      22,
      5,
      "40m",
    ),
    S("s12", "infra", "Terraform drift check", "ops/tf-drift", "error", "pi", 0, 0, "12m"),
    S(
      "s13",
      "frogg",
      "Voice alerts volume curve",
      "feat/voice-curve",
      "idle",
      "codex",
      11,
      11,
      "2d",
    ),
  ];
  const statusLabel = {
    running: "Running",
    permission: "Needs you",
    idle: "Idle",
    error: "Error",
    done: "Done",
  };

  const models = ["Opus 5.5", "Sonnet 5", "GPT-5.3 Codex", "Gemini 3 Pro"];

  function h(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  const esc = (s) =>
    String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const agentStyle = (a) => `--agent-h:${agents[a].hue}`;
  const dot = (status) => `<span class="dot dot-${status}" title="${statusLabel[status]}"></span>`;

  function ring(pct, label, size = 22) {
    const r = size / 2 - 3,
      c = 2 * Math.PI * r;
    return `<span class="ring" title="${label} ${pct}%"><svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="3"/>
      <circle class="ring-fill ${pct > 80 ? "hot" : ""}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="3"
        stroke-dasharray="${c}" stroke-dashoffset="${c}" data-target="${c * (1 - pct / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="round"/>
    </svg><span class="ring-label">${label}</span></span>`;
  }
  function animateRings(root) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        root
          .querySelectorAll(".ring-fill")
          .forEach((c) => (c.style.strokeDashoffset = c.dataset.target)),
      ),
    );
  }

  function composerHTML(opts = {}) {
    return `<div class="composer" data-state="idle">
      <div class="composer-notice">Queued: <b>“also add a migration test”</b> <button class="link">edit</button></div>
      <div class="composer-perm">
        <span class="perm-q">Allow <code>git push origin feat/session-store</code>?</span>
        <span class="perm-actions"><button class="btn deny" data-perm="deny">Deny <kbd>Esc</kbd></button><button class="btn approve" data-perm="approve">Approve <kbd>⏎</kbd></button></span>
      </div>
      <div class="composer-input" contenteditable="true" data-placeholder="${opts.placeholder || "Message the agent — Enter to steer, ⌘⏎ to queue"}"></div>
      <div class="composer-bar">
        <button class="chip chip-agent" style="${agentStyle("claude")}"><span class="agent-swatch"></span>Claude Code</button>
        <button class="chip chip-model">Opus 5.5 <span class="sub">· high</span></button>
        <button class="chip chip-mode">Auto-edit</button>
        <button class="chip chip-account">steve@work</button>
        <span class="rings">${ring(42, "5h")}${ring(86, "wk")}${ring(23, "ctx")}</span>
        <span class="bar-spacer"></span>
        <button class="icon-btn mic" title="Voice">${icons.mic}</button>
        <button class="send" title="Send"><span class="send-icon">${icons.send}</span><span class="stop-icon">${icons.stop}</span></button>
      </div>
    </div>`;
  }

  const icons = {
    mic: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    read: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h10l6 6v10H4z"/><path d="M14 4v6h6"/></svg>',
    run: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-5-6-5M12 19h8"/></svg>',
    edit: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h4L20 8l-4-4L4 16z"/></svg>',
    search:
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  };

  /* ---------- Transcript ---------- */
  const DIFF = [
    ["ctx", "  export function createSessionStore(db: Db) {"],
    ["del", "-   const cache = new Map<string, Session>();"],
    ["add", "+   const cache = new LRU<string, Session>({ max: 500 });"],
    ["add", "+   const writes = new WriteQueue(db, { flushMs: 50 });"],
    ["ctx", "    return {"],
    ["del", "-     save: (s) => db.put(s.id, s),"],
    ["add", "+     save: (s) => { cache.set(s.id, s); writes.enqueue(s); },"],
    ["add", "+     flush: () => writes.drain(),"],
  ];
  const STREAM1 =
    "The cache was an unbounded Map, so long-lived daemons kept every session ever opened in memory. I swapped it for an LRU capped at 500 and routed writes through a small queue that coalesces bursts — the composer fires a save on every keystroke while a draft is open, which was the real source of the write amplification you saw.";
  const STREAM2 =
    "Tests pass (142/142). The push is the last step; once it lands CI will run the desktop and daemon builds on the branch.";

  function staticTranscript(s) {
    const a = agents[s.agent];
    return `
      <div class="turn-divider"><span>${projects.find((p) => p.id === s.project).name} · ${s.branch}</span></div>
      <div class="msg user"><div class="bubble">${esc(s.title)} — can you take a look and propose a fix? Keep the public API stable.</div></div>
      <div class="msg agent" style="${agentStyle(s.agent)}"><div class="who"><span class="agent-swatch"></span>${a.name}</div>
        <div class="md"><p>I'll start by reading the relevant modules and the existing tests.</p></div></div>
      <div class="tool done group" data-count="5"><div class="tool-head"><span class="tool-ico">${icons.read}</span><span class="verb">Read</span><span class="target">5 files</span><span class="tool-meta">src/…</span><span class="tool-state"></span></div></div>
      <div class="tool done"><div class="tool-head"><span class="tool-ico">${icons.search}</span><span class="verb">Grep</span><span class="target">"${s.branch.split("/")[1]}"</span><span class="tool-meta">12 hits</span><span class="tool-state"></span></div></div>
      ${
        s.status === "error"
          ? `<div class="tool fail"><div class="tool-head"><span class="tool-ico">${icons.run}</span><span class="verb">Run</span><span class="target">pnpm test --filter ${s.project}</span><span class="tool-meta">exit 1</span><span class="tool-state"></span></div><pre class="tool-err">FAIL  src/retry.test.ts › backs off on 429\n  Expected: 3 attempts\n  Received: 1 attempt</pre></div>
        <div class="msg agent error-msg" style="${agentStyle(s.agent)}"><div class="md"><p>Provider error: <code>overloaded_error</code> after 3 retries. Resume when ready.</p></div></div>`
          : ""
      }
      ${s.status === "permission" ? `<div class="perm" data-static><div class="perm-head">${icons.lock}<span>Permission needed</span></div><div class="perm-body">Run <code>pnpm db:migrate --env staging</code></div><div class="perm-actions"><button class="btn deny">Deny <kbd>Esc</kbd></button><button class="btn ghost">Always for this session</button><button class="btn approve">Approve <kbd>⏎</kbd></button></div></div>` : ""}
      ${
        s.status === "done" || s.status === "idle"
          ? `<div class="msg agent" style="${agentStyle(s.agent)}"><div class="md"><p>Done. ${s.add ? `Changed ${Math.max(1, Math.round(s.add / 60))} files (<span class="add">+${s.add}</span> <span class="del">−${s.del}</span>).` : "No changes were needed."} Want me to open a PR?</p></div></div>
        <div class="turn-footer"><span>${a.name} · Opus 5.5</span><span>18.4k tokens</span><button class="link">Copy</button><button class="link">Fork</button></div>`
          : ""
      }
      ${s.status === "running" ? `<div class="thinking"><span class="shimmer">Running tests</span><span class="elapsed">0:41</span></div>` : ""}`;
  }

  async function streamInto(el, text, isLive) {
    const words = text.split(/(\s+)/);
    for (let i = 0; i < words.length; i++) {
      if (!isLive()) return;
      const sp = document.createElement("span");
      sp.className = "tok";
      sp.textContent = words[i];
      el.appendChild(sp);
      if (words[i].trim())
        await sleep(reduce ? 5 : 22 + Math.random() * 38 + (Math.random() < 0.06 ? 160 : 0));
      el.dispatchEvent(new CustomEvent("streamtick", { bubbles: true }));
    }
  }

  function liveTranscript(container, ctx) {
    let gen = ++ctx.gen;
    const live = () => gen === ctx.gen;
    const scroller = ctx.scroller || container;
    const stick = () => {
      scroller.scrollTop = scroller.scrollHeight;
    };
    container.addEventListener("streamtick", stick);
    container.innerHTML = `
      <div class="turn-divider"><span>frogg-app · feat/session-store · worktree</span></div>
      <div class="msg user"><div class="bubble">The daemon's RSS keeps climbing on long-lived hosts. Look at the session store, bound the cache, and batch the writes. Keep the public API stable.</div></div>
      <div class="msg agent" style="${agentStyle("claude")}"><div class="who"><span class="agent-swatch"></span>Claude Code</div>
        <details class="reasoning"><summary>Thought for 6 steps</summary><p>The store is created once per daemon; nothing evicts. Draft saves go through the same path…</p></details>
        <div class="md"><p>Reading the store, its callers and the persistence tests first.</p></div></div>
      <div class="tool done group"><div class="tool-head"><span class="tool-ico">${icons.read}</span><span class="verb">Read</span><span class="target">6 files</span><span class="tool-meta">session-store.ts, db.ts, …</span><span class="tool-state"></span></div>
        <div class="tool-body"><div>packages/server/src/session-store.ts</div><div>packages/server/src/db.ts</div><div>packages/server/src/drafts.ts</div><div>packages/server/test/session-store.test.ts</div><div>…2 more</div></div></div>`;
    stick();
    const add = (html) => {
      const n = h(html);
      container.appendChild(n);
      stick();
      return n;
    };
    (async () => {
      await sleep(500);
      if (!live()) return;
      const think = add(
        `<div class="thinking"><span class="shimmer">Thinking</span><span class="elapsed"></span></div>`,
      );
      await sleep(1400);
      if (!live()) return;
      think.remove();
      const edit = add(
        `<div class="tool running enter"><div class="tool-head"><span class="tool-ico">${icons.edit}</span><span class="verb">Edit</span><span class="target">session-store.ts</span><span class="tool-meta"><span class="add">+4</span> <span class="del">−2</span></span><span class="tool-state"></span></div><div class="tool-beam"></div></div>`,
      );
      await sleep(900);
      if (!live()) return;
      edit.classList.replace("running", "done");
      const hunk = h(
        `<div class="tool-body diff">${DIFF.map(([k, l], i) => `<div class="dl ${k}" style="--i:${i}">${esc(l)}</div>`).join("")}</div>`,
      );
      edit.appendChild(hunk);
      edit.classList.add("open");
      stick();
      await sleep(600);
      if (!live()) return;
      const m = add(
        `<div class="msg agent" style="${agentStyle("claude")}"><div class="md"><p class="streaming"></p></div></div>`,
      );
      ctx.setState && ctx.setState("streaming");
      await streamInto(m.querySelector("p"), STREAM1, live);
      if (!live()) return;
      m.querySelector("p").classList.remove("streaming");
      const run = add(
        `<div class="tool running enter"><div class="tool-head"><span class="tool-ico">${icons.run}</span><span class="verb">Run</span><span class="target">pnpm --filter server test</span><span class="tool-meta"></span><span class="tool-state"></span></div><div class="tool-beam"></div></div>`,
      );
      await sleep(1800);
      if (!live()) return;
      run.classList.replace("running", "done");
      run.querySelector(".tool-meta").textContent = "142 passed · 3.1s";
      await sleep(400);
      if (!live()) return;
      const perm = add(
        `<div class="perm enter"><div class="perm-head">${icons.lock}<span>Permission needed</span><span class="perm-agent">Claude Code · Bash</span></div><div class="perm-body">Run <code>git push origin feat/session-store</code></div><div class="perm-actions"><button class="btn deny" data-perm="deny">Deny <kbd>Esc</kbd></button><button class="btn ghost" data-perm="approve">Always for this session</button><button class="btn approve" data-perm="approve">Approve <kbd>⏎</kbd></button></div></div>`,
      );
      ctx.setState && ctx.setState("permission");
      const decision = await new Promise((res) => {
        ctx.resolvePerm = res;
      });
      if (!live()) return;
      ctx.resolvePerm = null;
      perm.classList.add("resolved", decision);
      perm.querySelector(".perm-actions").outerHTML =
        `<div class="perm-result">${decision === "approve" ? "Approved" : "Denied"} by you</div>`;
      ctx.setState && ctx.setState("streaming");
      if (decision === "approve") {
        const push = add(
          `<div class="tool running enter"><div class="tool-head"><span class="tool-ico">${icons.run}</span><span class="verb">Run</span><span class="target">git push origin feat/session-store</span><span class="tool-meta"></span><span class="tool-state"></span></div><div class="tool-beam"></div></div>`,
        );
        await sleep(1200);
        if (!live()) return;
        push.classList.replace("running", "done");
        push.querySelector(".tool-meta").textContent = "3 commits";
      }
      const m2 = add(
        `<div class="msg agent" style="${agentStyle("claude")}"><div class="md"><p class="streaming"></p></div></div>`,
      );
      await streamInto(
        m2.querySelector("p"),
        decision === "approve"
          ? STREAM2
          : "Understood — I left the commits local. Push whenever you are ready.",
        live,
      );
      if (!live()) return;
      m2.querySelector("p").classList.remove("streaming");
      add(
        `<div class="turn-footer"><span>Claude Code · Opus 5.5</span><span>31.2k tokens</span><button class="link">Copy</button><button class="link">Fork</button><button class="link">Clean cut</button></div>`,
      );
      ctx.setState && ctx.setState("idle");
      ctx.onDone && ctx.onDone();
    })();
  }

  function mountChat(container, session, ctx) {
    ctx.gen = (ctx.gen || 0) + 1;
    ctx.resolvePerm = null;
    if (session.id === "s1") liveTranscript(container, ctx);
    else {
      container.innerHTML = staticTranscript(session);
      (ctx.scroller || container).scrollTop = 1e6;
      ctx.setState &&
        ctx.setState(
          session.status === "running"
            ? "streaming"
            : session.status === "permission"
              ? "permission-static"
              : "idle",
        );
    }
  }

  function diffStripHTML(s) {
    const files = [
      ["session-store.ts", 112, 41],
      ["write-queue.ts", 64, 0],
      ["lru.ts", 31, 0],
      ["session-store.test.ts", 7, 46],
    ];
    return `<div class="dstrip"><button class="dstrip-sum"><span class="chev">›</span><b>${files.length} files changed</b> <span class="add">+${s.add}</span> <span class="del">−${s.del}</span></button>
      <span class="dstrip-files">${files.map(([f, a, d]) => `<span class="dfile">${f} <span class="add">+${a}</span><span class="del">−${d}</span></span>`).join("")}</span>
      <span class="dstrip-act"><button class="link">Review</button><button class="link">Keep all</button></span></div>`;
  }

  /* ---------- Command palette ---------- */
  function palette(onPick) {
    const el = h(
      `<div class="pal-scrim" hidden><div class="pal" role="dialog"><input class="pal-input" placeholder="Search sessions, commands, files, agents…"><div class="pal-list"></div><div class="pal-foot"><span><kbd>↑↓</kbd> move</span><span><kbd>⏎</kbd> open</span><span><kbd>⌘N</kbd> new session</span></div></div></div>`,
    );
    document.body.appendChild(el);
    const input = el.querySelector("input"),
      list = el.querySelector(".pal-list");
    const cmds = [
      "New session in frogg-app",
      "Open Overview",
      "Split with another session",
      "Toggle Changes pane",
      "Switch host…",
      "Settings",
    ];
    let items = [],
      sel = 0;
    function render() {
      const q = input.value.toLowerCase();
      const ss = sessions.filter((s) => s.title.toLowerCase().includes(q)).slice(0, 7);
      const cs = cmds.filter((c) => c.toLowerCase().includes(q)).slice(0, 4);
      items = [...ss.map((s) => ({ s })), ...cs.map((c) => ({ c }))];
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.innerHTML =
        (ss.length ? '<div class="pal-group">Sessions</div>' : "") +
        ss
          .map(
            (s, i) =>
              `<div class="pal-item ${i === sel ? "sel" : ""}" data-i="${i}">${dot(s.status)}<span class="pal-t">${esc(s.title)}</span><span class="pal-m">${projects.find((p) => p.id === s.project).name}</span></div>`,
          )
          .join("") +
        (cs.length ? '<div class="pal-group">Commands</div>' : "") +
        cs
          .map(
            (c, j) =>
              `<div class="pal-item ${ss.length + j === sel ? "sel" : ""}" data-i="${ss.length + j}"><span class="pal-cmd">›</span><span class="pal-t">${c}</span></div>`,
          )
          .join("");
    }
    function open() {
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add("open"));
      input.value = "";
      sel = 0;
      render();
      input.focus();
    }
    function close() {
      el.classList.remove("open");
      setTimeout(() => (el.hidden = true), reduce ? 0 : T.quick * 0.75);
    }
    function pick(i) {
      const it = items[i];
      close();
      if (it && it.s) onPick(it.s);
    }
    input.addEventListener("input", () => {
      sel = 0;
      render();
    });
    list.addEventListener("click", (e) => {
      const it = e.target.closest(".pal-item");
      if (it) pick(+it.dataset.i);
    });
    el.addEventListener("mousedown", (e) => {
      if (e.target === el) close();
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") {
        sel = Math.min(items.length - 1, sel + 1);
        render();
        e.preventDefault();
      }
      if (e.key === "ArrowUp") {
        sel = Math.max(0, sel - 1);
        render();
        e.preventDefault();
      }
      if (e.key === "Enter") pick(sel);
      if (e.key === "Escape") close();
    });
    document.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        el.hidden ? open() : close();
      }
    });
    return { open, close };
  }

  /* ---------- glue ---------- */
  function wireComposer(root, ctx) {
    const comp = root.querySelector(".composer");
    ctx.setState = (st) => {
      comp.dataset.state = st;
      ctx.onState && ctx.onState(st);
    };
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-perm]");
      if (b && ctx.resolvePerm) ctx.resolvePerm(b.dataset.perm);
      const send = e.target.closest(".send");
      if (send) {
        const inp = comp.querySelector(".composer-input");
        if (inp.textContent.trim()) {
          const n = h(
            `<div class="msg user pending"><div class="bubble">${esc(inp.textContent)}</div></div>`,
          );
          ctx.container.appendChild(n);
          inp.textContent = "";
          (ctx.scroller || ctx.container).scrollTop = 1e6;
          setTimeout(() => n.classList.remove("pending"), 500);
        }
      }
    });
    document.addEventListener("keydown", (e) => {
      if (!ctx.resolvePerm || document.querySelector(".pal-scrim.open")) return;
      if (
        e.key === "Enter" &&
        document.activeElement?.classList?.contains("composer-input") === false
      ) {
        e.preventDefault();
        ctx.resolvePerm("approve");
      }
      if (e.key === "Escape") ctx.resolvePerm("deny");
    });
    animateRings(comp);
  }

  // View-transition wrapper for session switches.
  function swap(fn) {
    if (document.startViewTransition && !reduce) document.startViewTransition(fn);
    else fn();
  }

  // Simulate background activity: a session finishes / a new one needs you.
  function ambient(onChange) {
    setTimeout(() => {
      const s = sessions.find((x) => x.id === "s9");
      s.status = "done";
      s.unread = 2;
      onChange(s, "done");
    }, 9000);
    setTimeout(() => {
      const s = sessions.find((x) => x.id === "s4");
      s.status = "permission";
      onChange(s, "permission");
    }, 16000);
  }

  window.Frogg = {
    agents,
    projects,
    sessions,
    statusLabel,
    models,
    icons,
    h,
    esc,
    dot,
    ring,
    animateRings,
    composerHTML,
    diffStripHTML,
    mountChat,
    palette,
    wireComposer,
    swap,
    ambient,
    agentStyle,
    reduce,
  };
})();
