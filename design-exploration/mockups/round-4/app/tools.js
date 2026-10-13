/* Rail tools. Each tool owns the side panel and the main area. */
window.Tools = (function () {
  const F = Frogg,
    { ic, esc, btn, badge, seg, tg, meter, sel, inp } = U;
  const order = [
    ["permission", "Needs you"],
    ["error", "Failed"],
    ["done", "Ready to review"],
    ["running", "Working"],
    ["idle", "Idle"],
  ];
  const proj = (s) => F.projects.find((p) => p.id === s.project);
  const cur = () => F.sessions.find((x) => x.id === S.cur);
  const th = (eyebrow, title, acts = "", sub = "") =>
    `<div class="th"><div class="th-t"><span class="eyebrow">${eyebrow}</span><h1><button class="m-back" data-back>←</button>${title}</h1>${sub ? `<div class="meta">${sub}</div>` : ""}</div><div class="acts">${acts}</div></div>`;
  const sideHead = (title, acts = "", sub = "") =>
    `<div class="lh"><h2 class="scope">${title}</h2><div class="lh-a">${acts}</div></div>${sub}`;
  const ib = (k, label, act = "") =>
    `<button class="ib" ${act} aria-label="${label}" title="${label}">${ic(k, 15)}</button>`;
  const L = (inner, cls = "") =>
    `<div class="list ${cls}" data-glide><div class="brk"><i></i><i></i><i></i><i></i></div>${inner}</div>`;
  const sect = (t, n = "", cls = "") =>
    `<div class="sec ${cls}"><span>${t}</span><i>${n}</i></div>`;
  const inScope = (s) =>
    S.scope === "all" || S.scope === "chats" || S.scope === "archived"
      ? true
      : s.project === S.scope;
  const scopeName = () =>
    S.scope === "all"
      ? `${R3.facet("frogg-all", ["#7fd9e6", "#045b9d"], 15)}All projects`
      : S.scope === "chats"
        ? `${ic("chat", 15)}Chats`
        : S.scope === "archived"
          ? `${ic("history", 15)}History`
          : `${R3.projFacet(S.scope, 15)}${F.projects.find((p) => p.id === S.scope).name}`;

  /* ---------------- Sessions ---------------- */
  function fleet() {
    const n = (k) => F.sessions.filter((s) => s.status === k && inScope(s)).length;
    return `<button class="fleet ready" data-act="fleet"><span class="segs">${order.map(([k]) => `<span class="seg seg-${k}" style="flex:${n(k)}"></span>`).join("")}</span><span class="fleet-l">${order
      .filter(([k]) => n(k))
      .map(([k, l]) => `<span>${R3.glyph(k)}<b>${n(k)}</b> ${l.toLowerCase()}</span>`)
      .join("")}</span></button>`;
  }
  const lbl = {
    s1: ["daemon", "#38bdf8"],
    s2: ["urgent", "#ff6b6b"],
    s4: ["mobile", "#3fcf8e"],
    s5: ["ui", "#8b7cf6"],
    s12: ["infra", "#fb923c"],
  };
  function srow(s) {
    const p = proj(s);
    const L2 = lbl[s.id];
    return `<button class="row st-${s.status} ${s.id === S.cur ? "on" : ""}" data-id="${s.id}" data-spot data-rowmenu>
      <span class="r1">${R3.glyph(s.status)}<b>${esc(s.title)}</b>${s.unread ? `<span class="u">${s.unread}</span>` : ""}<span class="ago">${s.ago}</span></span>
      <span class="r2">${R3.projFacet(p.id, 11)}<span>${p.name}</span><span class="br">${s.branch}</span>${L2 ? `<span class="lbl" style="--c:${L2[1]}">${L2[0]}</span>` : ""}${s.add ? `<span class="d"><span class="add">+${s.add}</span> <span class="del">−${s.del}</span></span>` : ""}</span>
      ${s.status === "permission" ? `<span class="r3"><span class="cmd"><code>${s.id === "s7" ? "Plan ready · 6 steps" : "pnpm db:migrate --env staging"}</code></span><span class="qa" data-qa="${s.id}">${s.id === "s7" ? "Review" : "Approve"} <kbd>A</kbd></span></span>` : ""}
      ${s.status === "error" ? `<span class="r3 e">${s.id === "s12" ? "terraform plan · host unreachable" : "exit 1 · retry.test.ts › backs off on 429"}</span>` : ""}
      ${s.id === "s1" ? `<span class="subs">${D.subagents.map(([t, k]) => `<span>${R3.glyph(k)}${t.split(":")[0]}</span>`).join("")}</span>` : ""}
    </button>`;
  }
  function sessionsSide() {
    let body;
    if (S.scope === "chats") {
      const g = [
        [
          "Today",
          [
            "Why does pnpm hoist differently in CI?",
            "Compare LRU libs for Node 24",
            "Explain HTTP/3 0-RTT replay risk",
          ],
        ],
        [
          "Yesterday",
          ["Regex for semver with build metadata", "Summarise the Electron 40 release notes"],
        ],
        [
          "Previous 7 days",
          [
            "Draft the 0.9.14 release notes",
            "Postgres 17 MERGE vs ON CONFLICT",
            "What is Zstd dictionary training",
          ],
        ],
      ];
      body = L(
        g
          .map(
            ([t, l]) =>
              sect(t, l.length) +
              l
                .map(
                  (x, i) =>
                    `<button class="row chat-row ${t === "Today" && !i ? "on" : ""}" data-spot><span class="r1">${ic("chat", 13)}<b>${x}</b></span><span class="r2"><span>Opus 5.5</span><span>· read-only sandbox</span></span></button>`,
                )
                .join(""),
          )
          .join(""),
      );
    } else if (S.scope === "archived") {
      const g = [
        [
          "This week",
          [
            ["Runner disk cleanup cron", "infra", "PR #1277 merged"],
            ["Plugin API: panel refresh hooks", "frogg", "PR #1266 merged"],
            ["Android adaptive icon", "frogg", "closed"],
          ],
        ],
        [
          "This month",
          [
            ["Billing: Stripe tax IDs", "billing", "PR #301 merged"],
            ["Docs: CLI reference regen", "docs", "archived by you"],
            ["Electron 40 upgrade", "frogg", "PR #1212 merged"],
          ],
        ],
      ];
      body =
        `<div class="ib-filter">${inp("", "Search history across hosts")}</div>` +
        L(
          g
            .map(
              ([t, l]) =>
                sect(t, l.length) +
                l
                  .map(
                    ([x, pj, m]) =>
                      `<div class="row st-idle" data-spot><span class="r1">${R3.glyph("done")}<b>${x}</b><span class="ago">${m.includes("merged") ? "merged" : ""}</span></span><span class="r2">${R3.projFacet(pj, 11)}<span>${m}</span><span class="d"><button class="link" data-act="restore">Restore</button></span></span></div>`,
                  )
                  .join(""),
            )
            .join("") + `<div class="more"><button class="link">Load more</button></div>`,
        );
    } else {
      body =
        fleet() +
        `<div class="ib-filter">${inp("", "Filter sessions")}<kbd>/</kbd></div>` +
        L(
          order
            .map(([k, label]) => {
              const list = F.sessions.filter((s) => s.status === k && inScope(s));
              if (!list.length) return "";
              return sect(label, list.length, `sec-${k}`) + list.map(srow).join("");
            })
            .join("") ||
            `<div class="none">No sessions in this project yet.<br>${btn("New session", "approve", 'data-act="new-session"')}</div>`,
        );
    }
    return `<div class="lh"><button class="scope scope-btn" data-act="scope-menu">${scopeName()}${ic("down", 12)}</button><div class="lh-a">${ib("filter", "Display options", 'data-act="display-menu"')}${ib("plus", "New session ⌘N", 'data-act="new-session"')}</div></div>${body}
    <div class="ib-f"><kbd>J</kbd><kbd>K</kbd> move <kbd>A</kbd> approve <kbd>⌘N</kbd> new <kbd>⌘K</kbd> commands</div>`;
  }

  /* ---------------- Search ---------------- */
  function searchSide() {
    const hits = [
      [
        "packages/server/src/session-store.ts",
        [
          [2, 'import { <m>WriteQueue</m> } from "./write-queue";'],
          [8, "  const writes = new <m>WriteQueue</m>(db, { flushMs: 50 });"],
        ],
      ],
      [
        "packages/server/src/write-queue.ts",
        [
          [4, "export class <m>WriteQueue</m> {"],
          [31, "  // <m>WriteQueue</m> drains on idle or after flushMs"],
        ],
      ],
      [
        "packages/server/test/session-store.test.ts",
        [[12, 'vi.mock("../src/write-queue", () => ({ <m>WriteQueue</m>: FakeQueue }));']],
      ],
    ];
    return `${sideHead("Search", ib("refresh", "Refresh"))}
      <div class="sbar"><span class="inp big">${ic("search", 14)}<input value="WriteQueue"><span class="opts"><b class="on">Aa</b><b>ab</b><b>.*</b></span></span>
      <span class="inp">${ic("files", 13)}<input value="" placeholder="files to include, e.g. packages/server/**"></span>
      ${seg(["This session", "Project", "All sessions"], 0, "full")}</div>
      <div class="rsum">5 results in 3 files · 2 conversations</div>
      ${L(
        hits
          .map(
            ([f, ls], i) =>
              `<div class="hitf">${ic("file", 13)}<b>${f.split("/").pop()}</b><i>${f.split("/").slice(0, -1).join("/")}</i><span>${ls.length}</span></div>` +
              ls
                .map(
                  ([n, l], j) =>
                    `<button class="hit ${i === 0 && j === 1 ? "on" : ""}" data-spot><i>${n}</i><code>${esc(
                      l,
                    )
                      .replace(/&lt;m&gt;/g, "<mark>")
                      .replace(/&lt;\/m&gt;/g, "</mark>")}</code></button>`,
                )
                .join(""),
          )
          .join("") +
          sect("In conversations", 2) +
          [
            [
              "Session store persistence refactor",
              "…routed writes through a <mark>WriteQueue</mark> that coalesces bursts…",
            ],
            [
              "Fix composer draft loss on reconnect",
              "…does the <mark>WriteQueue</mark> flush before the socket closes?…",
            ],
          ]
            .map(
              ([t, l]) =>
                `<button class="hit conv" data-spot>${ic("chat", 13)}<span><b>${t}</b><code>${l}</code></span></button>`,
            )
            .join(""),
      )}`;
  }
  function codeView(hl = [], marks = {}, opts = {}) {
    return `<div class="code">${D.code
      .map((l, i) => {
        const n = i + 1;
        let t = esc(l)
          .replace(/("[^"]*")/g, "\u0001$1\u0002")
          .replace(
            /\b(import|from|export|function|const|return|new|type|async|await)\b/g,
            "\u0003$1\u0002",
          )
          .replace(/(\/\*\*.*\*\/)/, "\u0004$1\u0002")
          .replace(/\u0001/g, '<span class="str">')
          .replace(/\u0003/g, '<span class="kw">')
          .replace(/\u0004/g, '<span class="cm">')
          .replace(/\u0002/g, "</span>");
        if (marks[n]) t = t.replace(marks[n], `<mark>${marks[n]}</mark>`);
        const g =
          opts.gutter && [1, 2, 7, 8, 13, 14, 16].includes(n)
            ? n <= 2 || n === 16
              ? "ga"
              : "gm"
            : "";
        return `<div class="cl ${hl.includes(n) ? "hl" : ""} ${g}"><span class="ln">${n}</span><span class="cx">${t || " "}</span></div>`;
      })
      .join("")}${opts.cursor ? "" : ""}</div>`;
  }
  const searchMain = () =>
    `${th("Search result · 2 of 5", "session-store.ts", btn("Open in Files", "ghost", 'data-tool="files"') + btn("Replace all…", "ghost") + btn("Add matches to chat"), '<span class="mono">packages/server/src/session-store.ts</span>')}<div class="ed-wrap">${codeView([8], { 2: "WriteQueue", 8: "WriteQueue" })}</div>`;

  /* ---------------- Files ---------------- */
  function filesSide() {
    return `${sideHead("Files", ib("plus", "New file") + ib("folder", "New folder") + ib("refresh", "Refresh") + ib("more", "Sort and hidden files", 'data-act="files-menu"'), `<div class="ctx-line">${R3.projFacet("frogg", 12)}<span>frogg-app</span><span class="mono">⎇ feat/session-store</span></div>`)}
      ${L(
        D.tree
          .map(
            ([d, k, n, x]) =>
              `<button class="tn ${n === "session-store.ts" ? "on" : ""} ${k}" style="--d:${d}" data-spot data-filemenu>${k === "dir" ? `<span class="tcar ${x ? "open" : ""}">${ic("chev", 11)}</span>${ic("folder", 14)}` : `<span class="tcar"></span>${ic("file", 14)}`}<span class="tl">${n}</span>${typeof x === "string" && x ? `<span class="fk fk-${x}">${x}</span>` : ""}</button>`,
          )
          .join(""),
        "tree",
      )}`;
  }
  const filesMain = () =>
    `<div class="tabs"><button class="tab on">${ic("file", 12)}<span>session-store.ts</span><span class="dirty">●</span></button><button class="tab">${ic("file", 12)}<span>write-queue.ts</span><span class="x">×</span></button><button class="tab">${ic("file", 12)}<span>frogg.json</span><span class="x">×</span></button><span class="tab-fill"></span></div>
    <div class="edbar"><span class="crumb"><span>packages</span><i>/</i><span>server</span><i>/</i><span>src</span><i>/</i><b>session-store.ts</b></span><span class="sp"></span>${seg(["Source", "Preview", "Diff"], 0)}${btn("Open in VS Code " + ic("down", 11), "ghost", 'data-act="editor-menu"')}${btn("Add to chat")}</div>
    <div class="ed-wrap">${codeView([12], {}, { gutter: true })}</div>
    <div class="edstat"><span class="vim">NORMAL</span><span>Ln 12, Col 7</span><span>Spaces: 2</span><span>UTF-8</span><span>TypeScript</span><span class="sp"></span><span>${R3.glyph("permission")} Unsaved · ⌘S</span></div>`;

  /* ---------------- Source control ---------------- */
  function scmSide() {
    const f = [
      ["session-store.ts", "packages/server/src", 112, 41, "M", 1],
      ["write-queue.ts", "packages/server/src", 64, 0, "A", 1],
      ["lru.ts", "packages/server/src/util", 31, 0, "A", 0],
      ["session-store.test.ts", "packages/server/test", 7, 46, "M", 0],
    ];
    const fr = ([n, d, a, dl, k], i) =>
      `<button class="file ${i === 0 ? "on" : ""}" data-spot data-filemenu><span class="fk fk-${k}">${k}</span><span class="fn"><b>${n}</b><i>${d}</i></span><span class="fs"><span class="add">+${a}</span> <span class="del">−${dl}</span></span></button>`;
    return `${sideHead("Source control", ib("refresh", "Refresh git and forge") + ib("more", "More git actions", 'data-act="git-more"'))}
      <div class="brcard"><button class="brsw" data-act="branch">${ic("branch", 14)}<b>feat/session-store</b>${ic("down", 11)}</button><span class="ab"><span>↑3</span><span>↓0</span> vs <b>main</b></span>
      <div class="bra">${btn("Pull", "ghost")}${btn("Push ↑3", "ghost")}${btn("Update from main", "ghost")}</div></div>
      <div class="commit"><div class="area-w"><textarea class="area" rows="2" placeholder="Commit message (⌘⏎)">Bound session cache and batch writes</textarea><button class="gen" title="Generate from changes">${ic("bolt", 13)}</button></div><div class="cm-a"><button class="btn approve grow">Commit 2 staged</button><button class="btn" data-act="commit-menu">${ic("down", 12)}</button></div></div>
      ${L(
        sect("Staged", 2) +
          f
            .filter((x) => x[5])
            .map(fr)
            .join("") +
          sect("Changes", 2) +
          f
            .filter((x) => !x[5])
            .map(fr)
            .join("") +
          sect("Session commits", 3) +
          D.commits
            .slice(0, 3)
            .map(
              ([h, t, a, ago]) =>
                `<button class="cmt" data-spot><span class="mono">${h}</span><b>${t}</b><i>${ago}</i></button>`,
            )
            .join("") +
          sect("Stashes", 1) +
          `<button class="cmt" data-spot><span class="mono">stash@{0}</span><b>WIP before draft-loss rebase</b><i>2d</i></button>`,
      )}`;
  }
  function scmMain() {
    const L1 = [
      [10, "  return {", 11, "  return {", "ctx"],
      [
        11,
        "    get: (id) => cache.get(id) ?? db.get(id),",
        12,
        "    get: async (id: string) => cache.get(id) ?? (await db.get(id)),",
        "mod",
      ],
      [12, "    save: (s) => db.put(s.id, s),", 13, "    save: (s: Session) => {", "mod"],
      ["", "", 14, "      cache.set(s.id, s);", "add"],
      ["", "", 15, "      writes.enqueue(s);", "add"],
      ["", "", 16, "    },", "add"],
      ["", "", 17, "    flush: () => writes.drain(),", "add"],
      [13, "    size: () => cache.size,", 18, "    size: () => cache.size,", "ctx"],
    ];
    const top = [
      [1, "", 1, 'import { LRU } from "./util/lru";', "add"],
      ["", "", 2, 'import { WriteQueue } from "./write-queue";', "add"],
      [
        1,
        'import type { Db, Session } from "./db";',
        3,
        'import type { Db, Session } from "./db";',
        "ctx",
      ],
      [
        5,
        "export function createSessionStore(db: Db) {",
        6,
        "export function createSessionStore(db: Db) {",
        "ctx",
      ],
      [
        6,
        "  const cache = new Map<string, Session>();",
        7,
        "  const cache = new LRU<string, Session>({ max: 500 });",
        "mod",
      ],
      ["", "", 8, "  const writes = new WriteQueue(db, { flushMs: 50 });", "add"],
    ];
    const r = ([a, la, b, lb, k]) =>
      `<div class="dr ${k}"><span class="ln">${a}</span><span class="dc l ${k === "mod" ? "del" : ""}">${esc(la)}</span><span class="ln">${b}</span><span class="dc r ${k === "add" || k === "mod" ? "add" : ""}">${esc(lb)}</span></div>`;
    return `${th("Changes · uncommitted", "session-store.ts", seg(["Uncommitted", "vs main"], 0) + seg(["Unified", "Split"], 1) + ib("eye", "Hide whitespace") + btn("Send 2 comments to agent", "approve"), '<span class="mono">packages/server/src · <span class="add">+112</span> <span class="del">−41</span> · 2 of 4 files</span>')}
    <div class="dview"><div class="dhunk">@@ -1,6 +1,8 @@</div>${top.map(r).join("")}
    <div class="rc"><div class="rc-h"><span class="av">you</span><b>Review comment</b><span>line 7</span></div><p>500 is arbitrary. Make the cap configurable via <code>config.json</code> (<code>sessionCache.max</code>) and log evictions at debug.</p><div class="rc-a"><button class="link">Edit</button><button class="link">Delete</button><span class="sp"></span><span class="att">Will attach to the next message</span></div></div>
    <div class="dhunk">@@ -10,4 +11,8 @@</div>${L1.map(r).join("")}
    <div class="rc draft"><div class="rc-h"><span class="av">you</span><b>New comment</b><span>line 15</span></div><textarea class="area" rows="2">Does enqueue() copy s, or can a later mutation race the flush?</textarea><div class="rc-a"><span class="sp"></span>${btn("Cancel", "ghost")}${btn("Add comment", "approve")}</div></div></div>`;
  }

  /* ---------------- PRs & CI ---------------- */
  function prsSide() {
    const t = S.prTab || "prs";
    const tabs = `<div class="stabs">${[
      ["prs", "Pull requests", 3],
      ["ci", "CI runs", 1],
      ["streams", "Streams", ""],
    ]
      .map(
        ([k, l, n]) =>
          `<button class="${t === k ? "on" : ""}" data-prtab="${k}">${l}${n ? ` <i>${n}</i>` : ""}</button>`,
      )
      .join("")}</div>`;
    let body;
    if (t === "ci")
      body =
        `<div class="ib-filter">${seg(["feat/session-store", "All branches"], 1, "full")}</div>` +
        L(
          D.runs
            .map(
              (r, i) =>
                `<button class="row prr ${i === 3 ? "on" : ""}" data-spot><span class="r1">${R3.glyph(r.st)}<b>${r.wf}</b><span class="ago">${r.t}</span></span><span class="r2"><span class="mono">#${r.id}</span><span class="br">${r.br}</span><span>${r.ev}</span></span></button>`,
            )
            .join("") +
            sect("Runners", "") +
            `<div class="runners"><div>${R3.glyph("running")}<b>2</b> busy</div><div>${R3.glyph("idle")}<b>1</b> queued</div><div><b>3</b> self-hosted · <b>∞</b> hosted</div></div>`,
        );
    else if (t === "streams")
      body = L(
        [
          "Development · main",
          "Beta · 0.9.15-beta.2",
          "Stable · 0.9.14",
          "Upstream beta",
          "Upstream stable",
        ]
          .map(
            (x, i) =>
              `<button class="row ${i === 1 ? "on" : ""}" data-spot><span class="r1">${R3.glyph(i < 2 ? "running" : "done")}<b>${x}</b><span class="ago">${[14, 6, 0, 3, 0][i]} waiting</span></span></button>`,
          )
          .join(""),
      );
    else
      body = L(
        sect("This session", 1) +
          prRow(D.prs[0], true) +
          sect("frogg-app · yours", 2) +
          D.prs
            .slice(1, 3)
            .map((p) => prRow(p))
            .join("") +
          sect("Recently closed", 2) +
          D.prs
            .slice(3)
            .map((p) => prRow(p))
            .join(""),
      );
    return `${sideHead("PRs & CI", ib("refresh", "Refresh") + ib("ext", "Open on GitHub"))}${tabs}${body}`;
  }
  const prState = (st) => `<span class="prs prs-${st.toLowerCase()}">${st}</span>`;
  const prRow = (p, on) =>
    `<button class="row prr ${on ? "on" : ""}" data-spot><span class="r1">${prState(p.st)}<b>${p.t}</b><span class="ago">#${p.n}</span></span><span class="r2"><span class="br">${p.br}</span><span class="d">${R3.glyph("done")}${p.checks[0]} ${p.checks[1] ? R3.glyph("error") + p.checks[1] : ""} ${p.checks[2] ? R3.glyph("running") + p.checks[2] : ""}</span></span></button>`;
  function prsMain() {
    const t = S.prTab || "prs";
    if (t === "ci") return ciMain();
    if (t === "streams") return streamsMain();
    return `${th("Pull request #1284 · GitHub", "Session store persistence refactor", btn("Ready for review", "ghost") + `<span class="split-btn">${btn("Squash and merge", "approve", 'data-act="merge"')}${btn(ic("down", 12), "approve", 'data-act="merge-menu"')}</span>` + btn(ic("ext", 14), "ghost icon"), `${prState("Draft")}<span class="mono">feat/session-store → main</span><span>3 commits · <span class="add">+214</span> <span class="del">−87</span></span><span>Auto-merge off</span>`)}
    <div class="prgrid"><div class="prcol">
      <section class="card"><h3>Checks <span>3 passed · 1 failed · 1 running</span></h3>${D.checks.map(([n, k, t2]) => `<div class="ck">${R3.glyph(k)}<b>${n}</b><span class="sp"></span><i>${t2}</i>${k === "error" ? btn("Add log to chat", "ghost sm") + btn("Re-run", "ghost sm") : `<button class="link">Logs</button>`}</div>`).join("")}</section>
      <section class="card"><h3>Reviews <span>0 of 1 required</span></h3><div class="ck"><span class="av">AN</span><b>ana-k</b><span class="sp"></span><i>review requested</i></div><div class="ck"><span class="av bot">CR</span><b>coderabbit</b><span class="sp"></span><i>2 comments · 1 resolved</i></div></section>
      <section class="card"><h3>Activity</h3>${[
        [
          "coderabbit",
          "commented on write-queue.ts:31",
          "“flush() can run concurrently with enqueue(); guard with a promise.”",
          "8m",
        ],
        ["Claude Code", "pushed 1 commit", "a41f9c2 Route session saves through WriteQueue", "4m"],
        ["ana-k", "was requested for review", "", "4m"],
      ]
        .map(
          ([a, v, q, t2]) =>
            `<div class="act"><span class="av">${a.slice(0, 2).toUpperCase()}</span><div><b>${a}</b> ${v}<i>${t2}</i>${q ? `<p>${q}</p>` : ""}</div></div>`,
        )
        .join(
          "",
        )}<div class="act-a">${btn("Send unresolved comments to agent", "ghost")}<span class="sp"></span><button class="link">1 outdated · show</button></div></section>
    </div><div class="prcol narrow">
      <section class="card"><h3>Session</h3><button class="minis" data-id="s1">${R3.glyph("running")}<b>Session store persistence refactor</b></button><p class="mut">Claude Code · Opus 5.5 · devbox</p></section>
      <section class="card"><h3>Merge</h3><p class="mut">Blocked: draft, 1 failing check, 0 of 1 approvals.</p>${U.row("Auto-merge when ready", "", tg(false))}${U.row("Archive session after merge", "", tg(true))}</section>
      <section class="card"><h3>Labels</h3><span class="lbl" style="--c:#38bdf8">daemon</span> <span class="lbl" style="--c:#8b7cf6">perf</span></section>
    </div></div>`;
  }
  function ciMain() {
    const log = `<span class="mut">2026-10-05T09:41:12Z</span> FAIL  packages/ui/test/locale.test.ts > ja > settings.notifications.title
<span class="del">  AssertionError: expected "通知" to have length ≤ 12 (got 14 with padding)</span>
<span class="mut">2026-10-05T09:41:12Z</span> FAIL  packages/ui/test/locale.test.ts > ar > rtl mirrors chevrons
<span class="del">  Error: snapshot mismatch (1 line)</span>

 <b>Test Files</b>  1 failed | 37 passed (38)
 <b>Tests</b>       2 failed | 118 passed (120)
<span class="mut">Error: Process completed with exit code 1.</span>`;
    return `${th("CI run #8801 · GitHub Actions", "CI · chore/i18n-settings", btn("Re-run failed", "ghost") + btn("Open run", "ghost") + btn("Add log to chat", "approve"), `${R3.glyph("error")}<span>Failed in 52s on test (windows)</span><span>pull_request · Copilot</span>`)}
    <div class="cigrid"><div class="jobs">${[
      ["typecheck", "done", "41s"],
      ["lint", "done", "17s"],
      ["test (linux)", "done", "3m 02s"],
      ["test (windows)", "error", "4m 11s"],
      ["desktop build", "idle", "skipped"],
    ]
      .map(
        ([n, k, t2], i) =>
          `<button class="job ${i === 3 ? "on" : ""}">${R3.glyph(k)}<b>${n}</b><i>${t2}</i></button>`,
      )
      .join("")}</div>
    <div class="logw"><div class="edbar"><b>test (windows)</b><span class="mut">· step 6 of 9 · Run pnpm test</span><span class="sp"></span>${inp("", "Filter log")}</div><pre class="term log">${log}</pre></div></div>`;
  }
  function streamsMain() {
    return `${th("Release streams · developer", "Beta · 0.9.15-beta.2", btn("Promote to stable…", "ghost") + btn("Copy command", "ghost"), "<span>6 changes waiting · forward-port from stable: 0</span>")}
    <div class="streams">${["Development", "Beta", "Stable"].map((n, i) => `<div class="stream s${i}"><b>${n}</b><span class="line"></span>${[0, 1, 2, 3].map((j) => `<span class="node" style="left:${15 + j * 22 + i * 4}%"></span>`).join("")}</div>`).join("")}</div>
    <div class="card pad">${seg(["All", "Features", "Fixes", "Waiting"], 3)}${["feat: notification inbox (persisted)", "fix: composer draft loss on reconnect", "feat: plugin panel refresh hooks", "fix: Windows path casing in worktree setup", "chore: settings strings in 9 locales", "fix: relay reconnect backoff"].map((x, i) => `<div class="ck">${R3.glyph(i % 2 ? "done" : "idle")}<b>${x}</b><span class="sp"></span><i class="mono">${["c1f2", "88ad", "4e10", "97bb", "0aa3", "5c6e"][i]}</i></div>`).join("")}</div>`;
  }

  /* ---------------- Terminals ---------------- */
  function termSide() {
    return `${sideHead("Terminals", ib("plus", "New terminal ⌘⇧T", 'data-act="term-new"') + ib("split", "Split"))}
    ${L(
      sect("Session terminals", 3) +
        D.terms
          .map(
            (t) =>
              `<button class="row ${t.on ? "on" : ""}" data-spot><span class="r1">${ic("terminal", 13)}<b>${t.name}</b>${t.svc ? badge("service") : ""}<span class="ago">${R3.glyph(t.st)}</span></span><span class="r2"><span class="br">${t.cwd}</span></span></button>`,
          )
          .join("") +
        sect("Scripts & services", "frogg.json") +
        D.scripts
          .map(
            ([n, c, k, st, url, port]) =>
              `<div class="script" data-spot><span class="r1">${R3.glyph(st)}<b>${n}</b>${k === "service" ? badge("service") : ""}<span class="sp"></span>${st === "running" ? ib("refresh", "Restart") + ib("stop", "Stop") : ib("play", "Run")}</span><span class="r2"><code>${c}</code><span class="d">${port}</span></span>${url ? `<span class="r2"><button class="link url" data-act="svc-url">${ic("globe", 12)} ${url}</button></span>` : ""}</div>`,
          )
          .join("") +
        sect("Setup", "") +
        `<button class="row" data-spot><span class="r1">${R3.glyph("done")}<b>Worktree setup log</b><span class="ago">pnpm i · 41s</span></span></button>`,
    )}`;
  }
  function termMain() {
    const t2 = `<pre class="term"><span class="mut">[dev]</span> VITE v7.1.3  ready in 612 ms
<span class="mut">[dev]</span>  ➜  Local:   <span class="pr">http://localhost:5173/</span>
<span class="mut">[dev]</span>  ➜  Proxy:   <span class="pr">https://session-store.frogg.local</span>
<span class="mut">[dev]</span> 09:42:07 [vite] hmr update /src/session-store.ts
<span class="mut">[dev]</span> 09:42:31 [vite] hmr update /src/write-queue.ts
<span class="mut">[dev]</span> 09:43:02 [daemon] session cache 214/500 · writes coalesced 38→4</pre>`;
    return `<div class="tabs"><button class="tab on">${ic("terminal", 12)}<span>zsh</span><span class="x">×</span></button><button class="tab">${ic("terminal", 12)}<span>pnpm dev</span><span class="x">×</span></button><button class="tab">${ic("terminal", 12)}<span>vitest --watch</span><span class="x">×</span></button><button class="tab add" data-act="term-new">${ic("plus", 14)}</button><span class="tab-fill"></span><span class="tabacts">${ib("split", "Split right ⌘\\")}${ib("copy", "Copy")}${ib("more", "More")}</span></div>
    <div class="tsplit"><div class="tpane on">${R3.terminal()}</div><div class="tpane"><div class="tph">${ic("globe", 12)} pnpm dev · service · <button class="link" data-act="svc-url">session-store.frogg.local</button></div>${t2}</div></div>`;
  }

  /* ---------------- Tasks ---------------- */
  function tasksSide() {
    const t = S.taskTab || "plan";
    const tabs = `<div class="stabs">${[
      ["plan", "Agent plan"],
      ["todos", "Project to-dos"],
    ]
      .map(([k, l]) => `<button class="${t === k ? "on" : ""}" data-tasktab="${k}">${l}</button>`)
      .join("")}</div>`;
    const body =
      t === "plan"
        ? `<div class="ctx-line">${R3.glyph("running")}<span>Session store persistence refactor</span></div>` +
          L(
            sect("Plan · 3 of 6", "") +
              D.plan
                .map(
                  ([x, k], i) =>
                    `<button class="row prow st-${k} ${i === 3 ? "on" : ""}" data-spot><span class="r1">${R3.glyph(k)}<b>${x}</b></span></button>`,
                )
                .join("") +
              sect("Subagents", 3) +
              D.subagents
                .map(
                  ([x, k, m, type]) =>
                    `<div class="row st-${k}" data-spot><span class="r1">${R3.glyph(k)}<b>${x}</b></span><span class="r2"><span>${type}</span><span class="br">${m}</span><span class="d">${k === "done" ? '<button class="link">Detach</button>' : ""}</span></span></div>`,
                )
                .join("") +
              `<div class="more"><button class="link">Archive finished subagents</button></div>`,
          )
        : `<div class="ib-filter">${seg(["Open", "All"], 0)}${ib("plus", "New to-do")}</div>` +
          L(
            ["daemon", "billing", "mobile", "i18n", "ui"]
              .map((c) => {
                const l = D.todos.filter((x) => x[5] === c);
                return l.length
                  ? sect(c, l.length) +
                      l
                        .map(
                          ([id, x, st, pr, cl], i) =>
                            `<button class="row ${id === "T-49" ? "on" : ""}" data-spot><span class="r1"><span class="pri p-${pr.toLowerCase()}">${pr[0]}</span><b>${x}</b><span class="ago mono">${id}</span></span><span class="r2"><span>${st}</span>${cl ? `<span class="br">${cl}</span>` : ""}</span></button>`,
                        )
                        .join("")
                  : "";
              })
              .join(""),
          );
    return `${sideHead("Tasks", ib("refresh", "Refresh"))}${tabs}${body}`;
  }
  function tasksMain() {
    const cols = ["Ready", "Claimed", "In progress", "Review", "Blocked", "Done"];
    return `${th("Project to-dos · frogg-app", "Board", seg(["Board", "List"], 0) + sel("Group: Status") + btn("New to-do", "approve", 'data-act="todo-new"'), "<span>9 to-dos · 4 claimed by agents · 1 stale claim</span>")}
    <div class="board">${cols
      .map(
        (c) =>
          `<div class="bcol"><h4>${c}<i>${D.todos.filter((x) => x[2] === c || (c === "Ready" && x[2] === "Backlog")).length}</i></h4>${D.todos
            .filter((x) => x[2] === c || (c === "Ready" && x[2] === "Backlog"))
            .map(
              ([id, x, st, pr, cl, cat]) =>
                `<div class="bcard ${id === "T-49" ? "on" : ""}" data-spot><span class="mono">${id} · ${cat}</span><b>${x}</b><span class="bc-m"><span class="pri p-${pr.toLowerCase()}">${pr}</span>${st === "Backlog" ? "<i>backlog</i>" : ""}${cl ? `<i>${cl}</i>` : ""}</span>${st === "Blocked" ? '<p class="blk">Waiting on Stripe sandbox keys</p>' : ""}${id === "T-38" ? '<p class="stale">Claim stale · 2d</p>' : ""}</div>`,
            )
            .join("")}</div>`,
      )
      .join("")}</div>`;
  }

  /* ---------------- Hosts ---------------- */
  function hostsSide() {
    return `${sideHead("Hosts", ib("plus", "Add host", 'data-act="add-host"'))}
    ${L(
      D.hosts
        .map(
          (h) =>
            `<button class="row hostr ${h.id === (S.host || "devbox") ? "on" : ""}" data-spot data-host="${h.id}"><span class="r1">${R3.glyph(h.status === "error" ? "error" : "done")}<b>${h.name}</b>${badge(h.kind)}<span class="ago">${h.lat}</span></span><span class="r2"><span>${h.os}</span><span class="d">${h.sessions} sessions</span></span>${h.err ? `<span class="r3 e">${h.err}</span>` : ""}${h.id === "devbox" ? `<span class="r3 w">${R3.glyph("permission")} 1 pairing request · 1 security warning</span>` : ""}</button>`,
        )
        .join("") +
        sect("Discovered on your network", 1) +
        `<div class="row st-idle" data-spot><span class="r1">${R3.glyph("idle")}<b>studio-mini.local</b>${badge("needs pairing")}</span><span class="r2"><span>192.168.1.40:6767 · 0.9.14</span><span class="d"><button class="link" data-act="add-host">Pair</button></span></span></div>`,
    )}`;
  }
  function hostsMain() {
    const h = D.hosts.find((x) => x.id === (S.host || "devbox"));
    if (h.status === "error")
      return `${th("Host · Remote SSH", h.name, btn("Retry", "approve") + btn("Edit connection", "ghost") + btn(ic("more", 16), "ghost icon", 'data-act="host-menu"'))}<div class="state-card err big">${R3.glyph("error")}<div><b>Can’t reach ci-runner-2</b><p>${h.err}. Last connected 12m ago. 2 sessions are paused and show saved activity until it is back.</p><div class="acts">${btn("Retry now", "approve")}${btn("Redeploy over SSH…", "ghost", 'data-act="deploy"')}${btn("Remove host…", "ghost danger", 'data-act="remove-host"')}</div></div></div>`;
    return `${th(`Host · ${h.kind} · v${h.ver}`, h.name, btn("Pair a device", "ghost", 'data-act="pair-device"') + btn("Restart daemon", "ghost") + btn("Host settings", "ghost", 'data-settings="host"') + btn(ic("more", 16), "ghost icon", 'data-act="host-menu"'), `${R3.glyph("done")}<span>Connected via relay · ${h.lat}</span><span>${h.os}</span><span>up ${h.up}</span>`)}
    <div class="hgrid">
      <section class="card"><h3>Load</h3>${[
        ["CPU", h.cpu, "8 cores"],
        ["Memory", h.mem, "19.5 / 32 GiB"],
        ["Disk", h.disk, "338 / 470 GiB"],
      ]
        .map(([n, p, d]) => `<div class="mrow"><b>${n}</b>${meter(p)}<i>${d}</i></div>`)
        .join(
          "",
        )}<div class="mrow"><b>Daemon</b><span class="mut">pid 41822 · 412 MiB · 9 agents</span></div></section>
      <section class="card"><h3>Here now <span>3 devices</span></h3>${D.devices
        .slice(0, 3)
        .map(
          ([n, r, w, k]) =>
            `<div class="ck">${ic(k === "phone" ? "phone" : k === "web" ? "globe" : "laptop", 14)}<b>${n}</b><span class="mut">${w.split("·")[1] || w}</span><span class="sp"></span>${badge(r)}</div>`,
        )
        .join(
          "",
        )}<div class="req">${R3.glyph("permission")}<div><b>Firefox · ubuntu-ws wants Operator access</b><span>Match code <code>4F-K2</code> on that device</span></div>${btn("Deny", "ghost sm")}${btn("Approve", "approve sm")}</div></section>
      <section class="card"><h3>Security <span>1 warning</span></h3><div class="find warn">${ic("shield", 15)}<div><b>Listening on all interfaces without a password</b><p>Bound to 0.0.0.0:6767. Anyone on this network can request pairing.</p><div class="acts">${btn("Set a password", "approve sm")}${btn("Bind to loopback", "ghost sm")}${btn("This is intended", "ghost sm")}</div></div></div><div class="find ok">${ic("check", 15)}<div><b>Claim mode on · owner set</b></div></div></section>
      <section class="card"><h3>Storage <span>owned by Frogg · 31.8 GiB</span></h3>${[
        ["Worktrees", 21.4, 67],
        ["Agent state", 4.1, 13],
        ["Logs", 3.2, 10],
        ["Daemon versions", 1.9, 6],
        ["Uploads", 1.2, 4],
      ]
        .map(
          ([n, g, p]) =>
            `<div class="mrow"><b>${n}</b>${meter(p * 1.2, "thin")}<i>${g} GiB</i><button class="link">Clean</button></div>`,
        )
        .join("")}</section>
      <section class="card"><h3>Connections</h3>${[
        ["Relay", "relay.frogg.dev:443 · TLS", "18 ms", "done"],
        ["Direct", "devbox.lan:6767", "4 ms", "done"],
        ["SSH tunnel", "steve@devbox", "—", "idle"],
      ]
        .map(
          ([n, a, l, k]) =>
            `<div class="ck">${R3.glyph(k)}<b>${n}</b><span class="mono mut">${a}</span><span class="sp"></span><i>${l}</i></div>`,
        )
        .join("")}</section>
      <section class="card"><h3>Daemon</h3><div class="ck"><b>0.9.14</b><span class="mut">stable channel · self-update daily 02:00–05:00</span><span class="sp"></span>${badge("up to date", "ok")}</div><p class="mut">One update path: Frogg picks self-update, desktop bundle or SSH redeploy for this host.</p></section>
    </div>`;
  }

  /* ---------------- Usage ---------------- */
  function usageSide() {
    return `${sideHead("Usage", ib("refresh", "Refresh now") + ib("settings", "Meter settings", 'data-settings="usage"'))}
    ${L(
      sect("devbox · accounts", D.accounts.length) +
        D.accounts
          .map(
            (a, i) =>
              `<button class="row acct ${i === 0 ? "on" : ""}" data-spot><span class="r1"><span class="sw" style="background:${a.color}"></span><b>${a.name}</b>${a.def ? badge("default") : ""}<span class="ago">${a.plan}</span></span><span class="r2"><span>${a.prov}</span></span>${a.w.map(([n, p]) => `<span class="wl"><i>${n}</i>${meter(p)}<em>${p}%</em></span>`).join("")}</button>`,
          )
          .join(""),
    )}`;
  }
  function usageMain() {
    const a = D.accounts[0];
    const bars = [12, 18, 9, 22, 31, 27, 40, 35, 18, 14, 29, 42, 51, 38];
    return `${th("Claude Code · Max 20×", "steve@work", btn("Account settings", "ghost", 'data-settings="accounts"') + btn("Refresh", "ghost"), `<span>Refreshed 12s ago · every 30s</span><span>Warn at 65% · critical at 90%</span>`)}
    <div class="ugrid">${a.w.map(([n, p, r]) => `<section class="card big-m"><h3>${n}</h3><div class="bigpct ${p >= 90 ? "crit" : p >= 65 ? "warn" : ""}">${p}<small>%</small></div>${meter(p)}<p class="mut">${r}</p></section>`).join("")}
      <section class="card wide"><h3>Last 14 days <span>tokens per day, all sessions on this account</span></h3><div class="spark">${bars.map((b, i) => `<span style="height:${b * 1.6}px" title="${b}M"></span>`).join("")}</div></section>
      <section class="card wide"><h3>Top sessions today</h3><table class="tbl"><tr><th>Session</th><th>Model</th><th>Tokens</th><th>Context</th><th>Cost</th></tr>${[
        ["Session store persistence refactor", "Opus 5.5", "1.9M", 23, "$4.12"],
        ["Invoice PDF renderer", "Opus 5.5", "1.1M", 61, "$2.40"],
        ["Android push for approvals", "Sonnet 5", "640k", 12, "$0.71"],
        ["Rewrite pairing guide", "Opus 5.5", "410k", 88, "$0.93"],
      ]
        .map(
          ([t, m, tk, c, cost]) =>
            `<tr><td>${t}</td><td>${m}</td><td class="mono">${tk}</td><td>${meter(c, "thin")}</td><td class="mono">${cost}</td></tr>`,
        )
        .join("")}</table></section>
      <section class="card wide"><h3>When a limit is hit</h3>${U.row("Resume automatically when the window resets", "Agents wait, then continue. Countdown shows in the composer.", tg(true))}${U.row("Clean cut before resuming", "Summarise first so the resume doesn’t re-bill an expired cache.", tg(true))}${U.row("Or move to another account", "Offer a transfer to the next account with headroom.", sel("personal (Pro)"))}</section></div>`;
  }

  /* ---------------- Plugins ---------------- */
  function pluginsSide() {
    const t = S.plugTab || "installed";
    const tabs = `<div class="stabs">${[
      ["installed", "Installed", 5],
      ["browse", "Browse", ""],
      ["repos", "Sources", ""],
    ]
      .map(
        ([k, l, n]) =>
          `<button class="${t === k ? "on" : ""}" data-plugtab="${k}">${l}${n ? ` <i>${n}</i>` : ""}</button>`,
      )
      .join("")}</div>`;
    const body =
      t === "repos"
        ? L(
            sect("Repositories", 2) +
              [
                ["frogg official", "plugins.frogg.dev/index.json", "pinned key 9F:2A…"],
                ["acme internal", "git.acme.dev/frogg/index.json", "pinned key 41:C0…"],
              ]
                .map(
                  ([n, u, k], i) =>
                    `<button class="row ${i === 0 ? "on" : ""}" data-spot><span class="r1">${ic("book", 13)}<b>${n}</b></span><span class="r2"><span class="br">${u}</span><span class="d">${k}</span></span></button>`,
                )
                .join("") +
              sect("Local plugins · developer", 1) +
              `<button class="row" data-spot><span class="r1">${ic("folder", 13)}<b>bundle-size</b>${badge("linked")}</span><span class="r2"><span class="br">~/dev/frogg-bundle-size</span></span></button>` +
              `<div class="more">${btn("Add repository", "ghost")}${btn("Link local folder", "ghost")}</div>`,
          )
        : L(
            D.plugins
              .map(
                (p, i) =>
                  `<div class="row plg ${i === 0 && t === "installed" ? "on" : ""}" data-spot><span class="r1">${R3.facet(p.id, p.hue, 16)}<b>${p.name}</b>${badge(p.tier)}<span class="ago">${p.upd ? badge("update " + p.upd, "warn") : `v${p.ver}`}</span></span><span class="r2"><span class="pst pst-${p.st.toLowerCase()}">${p.st}</span><span class="br">${p.where}</span><span class="d">${tg(p.on)}</span></span>${p.err ? `<span class="r3 e">${p.err}</span>` : ""}</div>`,
              )
              .join(""),
          );
    return `${sideHead("Plugins", ib("search", "Search plugins") + ib("refresh", "Check for updates"))}${tabs}<div class="ib-filter"><span class="mut sm">Install on</span>${seg(["Host · devbox", "This client"], 0)}</div>${body}`;
  }
  function pluginsMain() {
    if ((S.plugTab || "installed") === "browse")
      return `${th("Browse · frogg official + acme internal", "Plugin catalog", inp("", "Search plugins") + sel("All categories"))}<div class="cgrid">${D.catalog
        .map(
          ([n, tier, cat, d], i) =>
            `<div class="pcard" data-spot>${R3.facet(
              n,
              [
                ["#7fd9e6", "#045b9d"],
                ["#3fcf8e", "#25b5c8"],
                ["#8b7cf6", "#25b5c8"],
                ["#f5b84a", "#e0605a"],
              ][i % 4],
              30,
            )}<div><b>${n}</b>${badge(tier)}<p>${d}</p><span class="mut sm">${cat}${i === 3 ? " · needs client component" : ""}</span></div>${btn(i === 4 ? "Installed" : "Install", i === 4 ? "ghost" : "", i === 0 ? 'data-act="consent"' : "")}</div>`,
        )
        .join("")}</div>`;
    const p = D.plugins[0];
    return `${th(`${p.tier} · v${p.ver} · installed on host`, `${R3.facet(p.id, p.hue, 22)} ${p.name}`, tg(true) + btn("Settings", "ghost", 'data-settings="plugins"') + btn("Uninstall…", "ghost danger"), `<span class="pst pst-active">Active</span><span>${p.desc}</span>`)}
    <div class="hgrid">
      <section class="card"><h3>Adds to Frogg</h3>${[
        ["sessions", "Rail tool", "Sentry issues (list panel)"],
        ["more", "Session action", "Attach release issues"],
        ["search", "Commands", "Sentry: open issue, resolve, assign (3)"],
        ["attach", "Composer action", "Insert stack trace"],
      ]
        .map(
          ([k, t, d]) =>
            `<div class="ck">${ic(k, 14)}<b>${t}</b><span class="mut">${d}</span></div>`,
        )
        .join("")}</section>
      <section class="card"><h3>Permissions granted</h3>${["Network: sentry.io", "Read workspace files", "Contribute UI (panels, commands)", "Read agent activity"].map((x) => `<div class="ck">${ic("check", 13)}<span>${x}</span></div>`).join("")}<p class="mut">Host plugins are not sandboxed. Review the source before installing from user repositories.</p></section>
      <section class="card wide"><h3>Settings</h3>${U.row("Organisation slug", "", inp("acme"))}${U.row("Auth token", "Stored in the host’s secret store", inp("••••••••••••••••", "", "mono"))}${U.row("Project", "", sel("frogg-app"))}${U.row("Show resolved issues", "", tg(false))}</section>
    </div>`;
  }

  /* ---------------- Plugin-contributed panel ---------------- */
  function sentrySide() {
    const issues = [
      [
        "TypeError: Cannot read properties of undefined (reading 'socket')",
        "reconnect() · client",
        "412",
        "error",
        true,
      ],
      ["Write queue flush exceeded 2s", "WriteQueue.drain · daemon", "38", "permission"],
      ["ENOSPC: no space left on device", "worktree setup · ci-runner-2", "12", "error"],
      ["Relay handshake timeout", "relay-client · android", "7", "idle"],
    ];
    return `${sideHead(`${R3.facet("sentry", ["#8b7cf6", "#362d59"], 16)} Sentry`, ib("refresh", "Refresh") + ib("ext", "Open in Sentry"), `<div class="ctx-line"><span class="mut sm">Panel from the Sentry plugin · release 0.9.14-beta.3</span></div>`)}
    <div class="ib-filter">${seg(["Unresolved", "For this session", "All"], 0, "full")}</div>${L(issues.map(([t, w, n, k, on]) => `<button class="row ${on ? "on" : ""}" data-spot><span class="r1">${R3.glyph(k)}<b>${t}</b></span><span class="r2"><span class="br">${w}</span><span class="d mono">${n} events</span></span></button>`).join(""))}`;
  }
  const sentryMain = () =>
    `${th("Sentry issue FROGG-APP-3F2 · plugin panel", "TypeError in reconnect()", btn("Attach to chat", "approve") + btn("Resolve", "ghost") + btn("Open in Sentry", "ghost"), "<span>412 events · 61 users · first seen 0.9.14-beta.3 · last 3m ago</span>")}
    <div class="md-panel"><h3>Stack trace</h3><pre class="term">TypeError: Cannot read properties of undefined (reading 'socket')
  at reconnect (<b>apps/ui/src/connection/reconnect.ts:88:21</b>)
  at Backoff.tick (apps/ui/src/connection/backoff.ts:41:5)
  at Timeout._onTimeout (node:internal/timers:594:17)</pre>
    <h3>Suspect commit</h3><p><code>4e1077b</code> “fix: relay reconnect backoff” by Codex · fix/relay-backoff · merged 2d ago</p>
    <h3>Breadcrumbs</h3><div class="crumbs">${["09:41:02 ws close 1006", "09:41:02 backoff 400ms", "09:41:03 relay handshake start", "09:41:03 TypeError"].map((x) => `<div class="mono">${x}</div>`).join("")}</div>
    <div class="acts">${btn("Start a session to fix this", "approve", 'data-act="new-session"')}<span class="mut sm">Prefills prompt, stack trace and suspect commit</span></div></div>`;

  function linearSide() {
    const l = [
      ["ENG-812", "Notification inbox", "In Progress", "s1"],
      ["ENG-809", "Unify permission mode labels", "Todo"],
      ["ENG-790", "Draft loss on reconnect", "In Review", "s2"],
      ["ENG-777", "Single daemon update path", "Backlog"],
    ];
    return `${sideHead(`${R3.facet("linear", ["#7fd9e6", "#5e6ad2"], 16)} Linear`, ib("refresh", "Refresh"), `<div class="ctx-line"><span class="mut sm">Panel from the Linear plugin · team ENG · cycle 42</span></div>`)}${L(l.map(([id, t, st, ses], i) => `<button class="row ${i === 0 ? "on" : ""}" data-spot><span class="r1">${R3.glyph(st === "In Progress" ? "running" : st === "In Review" ? "done" : "idle")}<b>${t}</b><span class="ago mono">${id}</span></span><span class="r2"><span>${st}</span>${ses ? `<span class="br">linked session</span>` : ""}</span></button>`).join(""))}`;
  }
  const linearMain = () =>
    `${th("Linear ENG-812 · plugin panel", "Notification inbox", btn("Link to session", "ghost") + btn("Start a session", "approve", 'data-act="new-session"'), "<span>In Progress · cycle 42 · assigned to you</span>")}<div class="md-panel"><h3>Description</h3><p>Persist every attention event (finished, failed, needs you, CI, storage, plugin) with read state. Toasts and OS notifications become views of the same item.</p><h3>Plugin form</h3>${U.row("Status", "", U.sel("In Progress"))}${U.row("Estimate", "", U.seg(["S", "M", "L"], 1))}<div class="acts">${U.btn("Save", "approve")}</div></div>`;

  /* ---------------- Inbox ---------------- */
  function inboxSide() {
    const groups = [
      ["Needs you", (n) => n.k === "permission"],
      ["Failures", (n) => n.k === "error" || n.k === "ci"],
      ["Finished", (n) => n.k === "done"],
      ["Hosts, plugins & updates", (n) => ["system", "plugin", "device"].includes(n.k)],
    ];
    return `${sideHead("Inbox " + badge("new", "new"), ib("check", "Mark all read") + ib("settings", "Notification rules", 'data-settings="notify"'))}
    <div class="ib-filter">${seg(["All 11", "Unread 4", "Mentions"], 0, "full")}</div>
    ${L(
      groups
        .map(([t, f]) => {
          const l = D.notes.filter(f);
          return (
            sect(
              t,
              l.length,
              t === "Needs you" ? "sec-permission" : t === "Failures" ? "sec-error" : "",
            ) +
            l
              .map(
                (n, i) =>
                  `<button class="row note ${n.unread ? "unread" : ""} ${t === "Needs you" && i === 0 ? "on" : ""}" data-spot><span class="r1">${U.glyph(n.k)}<b>${n.t}</b><span class="ago">${n.ago}</span></span><span class="r2"><span class="br">${n.d}</span></span></button>`,
              )
              .join("")
          );
        })
        .join(""),
    )}
    <div class="ib-f">Kept 30 days · OS notifications and toasts mirror this list</div>`;
  }
  function inboxMain() {
    return `${th("Notification · 1m ago · from Codex on devbox", "Fix composer draft loss on reconnect", btn("Open session", "ghost", 'data-id="s2"') + btn("Mute this session", "ghost") + btn(ic("more", 16), "ghost icon"), `${R3.glyph("permission")}<span>Needs you</span><span>frogg-app / fix/draft-loss</span>`)}
    <div class="inbox-d">${Chat.permCard("pnpm db:migrate --env staging", '<div class="perm-ctx">Applies 2 migrations to <b>staging</b>: <code>0042_draft_versions</code>, <code>0043_draft_index</code></div>')}
    <div class="card pad"><h3>Context</h3><p>Last agent message: “Drafts are now versioned so a reconnect can’t overwrite a newer local copy. The migration adds <code>draft_versions</code> and an index; I need to apply it to staging to run the e2e test.”</p><div class="ck">${ic("files", 14)}<b>3 files changed</b><span class="add">+32</span> <span class="del">−9</span><span class="sp"></span><button class="link" data-tool="scm">Review changes</button></div></div>
    <div class="card pad"><h3>Delivered</h3><div class="ck">${ic("laptop", 14)}<b>Desktop notification</b><span class="mut">Steve’s MacBook Pro · 1m ago</span></div><div class="ck">${ic("phone", 14)}<b>Push</b><span class="mut">Pixel 9 · 1m ago · not opened</span></div><div class="ck">${ic("voice", 14)}<b>Spoken alert</b><span class="mut">off for this session</span></div></div></div>`;
  }

  const list = [
    {
      id: "sessions",
      label: "Sessions",
      ic: "sessions",
      side: sessionsSide,
      main: (S) => Chat.main(S),
      badge: () =>
        F.sessions.filter((s) => s.status === "permission" || s.status === "error").length,
      k: "⌘1",
    },
    { id: "search", label: "Search", ic: "search", side: searchSide, main: searchMain, k: "⌘⇧F" },
    { id: "files", label: "Files", ic: "files", side: filesSide, main: filesMain, k: "⌘⇧E" },
    {
      id: "scm",
      label: "Source control",
      ic: "scm",
      side: scmSide,
      main: scmMain,
      badge: () => 4,
      dim: true,
      k: "⌘⇧G",
    },
    {
      id: "prs",
      label: "PRs & CI",
      ic: "pr",
      side: prsSide,
      main: prsMain,
      badge: () => 1,
      bad: true,
      k: "⌘⇧R",
    },
    {
      id: "terminals",
      label: "Terminals & services",
      ic: "terminal",
      side: termSide,
      main: termMain,
      k: "⌃`",
    },
    { id: "tasks", label: "Tasks", ic: "tasks", side: tasksSide, main: tasksMain, k: "⌘⇧L" },
    "-",
    {
      id: "hosts",
      label: "Hosts & devices",
      ic: "hosts",
      side: hostsSide,
      main: hostsMain,
      badge: () => 1,
      bad: true,
    },
    {
      id: "usage",
      label: "Usage & limits",
      ic: "usage",
      side: usageSide,
      main: usageMain,
      warn: true,
    },
    { id: "plugins", label: "Plugins", ic: "plugins", side: pluginsSide, main: pluginsMain },
    "plugins",
    {
      id: "sentry",
      label: "Sentry (plugin)",
      plugin: ["sentry", ["#8b7cf6", "#362d59"]],
      side: sentrySide,
      main: sentryMain,
      badge: () => 4,
      dim: true,
    },
    {
      id: "linear",
      label: "Linear (plugin)",
      plugin: ["linear", ["#7fd9e6", "#5e6ad2"]],
      side: linearSide,
      main: linearMain,
    },
    "fill",
    { id: "inbox", label: "Inbox", ic: "inbox", side: inboxSide, main: inboxMain, badge: () => 4 },
    { id: "voice", label: "Companion (preview)", ic: "voice", act: "companion" },
    {
      id: "settings",
      label: "Settings",
      ic: "settings",
      side: () => Settings.side(),
      main: () => Settings.main(),
      k: "⌘,",
    },
  ];
  return {
    list,
    get: (id) => list.find((t) => t.id === id),
    th,
    sideHead,
    ib,
    L,
    sect,
    inScope,
    order,
  };
})();
